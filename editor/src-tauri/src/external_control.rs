// editor/src-tauri/src/external_control.rs
//
// 本地 HTTP 控制入口：外部工具（如 CLI/skill）经 `127.0.0.1:<port>` 发 HTTP 请求，
// server 把请求转发给 webview（`external-control://request` 事件），webview 处理完
// 经 `external_control_reply` 命令回执，server 收到后再把结果作为 HTTP 响应返回。
// 每请求校验 `x-kiny-token` 头，避免同机其它进程冒用。
//
// 生命周期（T040 冒烟修复）：control.json 由 **Rust 持有**——start 绑定成功后由 Rust 写、
// stop / 启动清理时由 Rust 删，使「文件存在 ⟺ 端口在监听」成为强不变量。start/stop 带
// **代际号（generation）**，令 dev StrictMode 双挂载下旧代际的补偿 stop 不误杀新代际的 server，
// 且落后一代的 start 自我超代放弃（不写文件/不存句柄），保证文件与句柄同代、无孤儿。
use std::collections::HashMap;
use std::sync::Mutex;
use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::any, Router};
use axum::body::Bytes;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// 待 webview 回执的表：请求 id → oneshot 发送端。仿 lib.rs 的 LaunchProject managed-state 范式。
#[derive(Default)]
pub struct PendingReplies(pub Mutex<HashMap<String, oneshot::Sender<Reply>>>);

/// 控制服务的运行态：当前句柄 + 单调代际计数。
#[derive(Default)]
pub struct ControlHandle(pub Mutex<ControlState>);

#[derive(Default)]
pub struct ControlState {
    /// 当前在跑的 server 句柄（None = 未启动）。
    pub running: Option<Running>,
    /// 单调递增的代际计数：每次 start 领一个新号，用于代际安全的 stop / 自我超代。
    pub next_gen: u64,
}

/// 一代运行中的 server：代际号 + 该代 serve 任务的 JoinHandle（stop 时 abort）。
/// 注：`tauri::async_runtime::JoinHandle` 直接在句柄本身暴露 `abort()`（无独立 AbortHandle 类型）。
pub struct Running {
    pub generation: u64,
    pub abort: tauri::async_runtime::JoinHandle<()>,
}

pub struct Reply { pub status: u16, pub body: String }

#[derive(Clone, Serialize)]
struct ExternalRequest { id: String, method: String, path: String, body: serde_json::Value }

/// start 回给前端的信息：端口（供 UI 指示）+ 代际号（供前端 stop 时代际安全地指名停自己那一代）。
#[derive(Serialize)]
pub struct ControlInfo { pub port: u16, pub generation: u64 }

/// axum handler 与 Tauri 的共享上下文。
#[derive(Clone)]
struct Ctx { app: AppHandle, token: String }

/// 纯函数：请求头 token 是否匹配（便于单测）。
pub fn check_token(expected: &str, got: Option<&str>) -> bool {
    matches!(got, Some(t) if t == expected)
}

/// 纯函数：一次 stop 是否应作用于当前句柄。
/// - 请求 None = force：恒真（用于启动清理 / 无条件停）。
/// - 请求 Some(g)：仅当当前句柄存在且代际恰为 g 才真——旧代际的补偿 stop 命中新代际时为假，不误杀。
pub fn stop_matches(current: Option<u64>, requested: Option<u64>) -> bool {
    match requested {
        None => true,
        Some(g) => current == Some(g),
    }
}

/// control.json 的绝对路径：`<AppData>/<identifier>/external-control/control.json`。
/// 与 CLI `cli/src/controlFile.ts` 的解析一致（Tauri app_data_dir = <AppData>/<identifier>）。
fn control_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("external-control").join("control.json"))
}

/// 写 control.json（`{port, token}`，格式与 CLI 所读一致）。父目录不存在则建。
fn write_control_file(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let path = control_file_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::json!({ "port": port, "token": token }).to_string();
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

/// best-effort 删 control.json（stop 命中 / 启动清理陈旧文件用）；失败静默。
pub fn delete_control_file(app: &AppHandle) {
    if let Ok(path) = control_file_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

async fn proxy(State(cx): State<Ctx>, req: axum::extract::Request) -> impl IntoResponse {
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let token_ok = check_token(&cx.token, req.headers().get("x-kiny-token").and_then(|v| v.to_str().ok()));
    if !token_ok {
        return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
    }
    // 读 body（POST /command 为 JSON；GET 为空）
    let bytes = axum::body::to_bytes(req.into_body(), 1 << 20).await.unwrap_or_else(|_| Bytes::new());
    let body: serde_json::Value = if bytes.is_empty() { serde_json::Value::Null }
        else { serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null) };

    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<Reply>();
    cx.app.state::<PendingReplies>().0.lock().unwrap().insert(id.clone(), tx);

    // T038 起编辑器是独立的 'editor' 窗口（启动窗是 'launch'，无 'main'）；外部控制驱动的是
    // 跑 useExternalControl 的编辑窗。emit 为全局广播，编辑窗监听器照样收到；此处仅守「编辑窗存在」。
    if cx.app.get_webview_window("editor").is_none() {
        cx.app.state::<PendingReplies>().0.lock().unwrap().remove(&id);
        return (StatusCode::SERVICE_UNAVAILABLE, "editor window not ready").into_response();
    }
    let _ = cx.app.emit("external-control://request", ExternalRequest { id: id.clone(), method, path, body });

    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(reply)) => (StatusCode::from_u16(reply.status).unwrap_or(StatusCode::OK),
                          [("content-type", "application/json")], reply.body).into_response(),
        _ => {
            cx.app.state::<PendingReplies>().0.lock().unwrap().remove(&id);
            (StatusCode::GATEWAY_TIMEOUT, "webview 未在时限内回执").into_response()
        }
    }
}

/// 启动 server：绑 127.0.0.1:0（临时端口），Rust 写 control.json，返回实际 port + 代际号。
/// 幂等 + 代际安全：领代号时先 abort 上一代；bind 后在临界区里校验本代仍是最新一代
/// （否则自我超代放弃：abort 自己刚 spawn 的 server、不写文件、不存句柄），保证文件与句柄同代、无孤儿。
/// 注意锁作用域：领代号 / 存句柄两段各自短临界区，不跨 `.await`（避免阻塞 + clippy::await_holding_lock）。
#[tauri::command]
pub async fn start_external_control(app: AppHandle) -> Result<ControlInfo, String> {
    let generation = {
        let ctrl = app.state::<ControlHandle>();
        let mut st = ctrl.0.lock().unwrap();
        if let Some(prev) = st.running.take() {
            prev.abort.abort();
        }
        st.next_gen += 1;
        st.next_gen
    };
    let token = uuid::Uuid::new_v4().to_string();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let cx = Ctx { app: app.clone(), token: token.clone() };
    let router = Router::new().route("/{*path}", any(proxy)).route("/", any(proxy)).with_state(cx);
    let task = tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    // bind 后：校验本代仍最新 → 写文件 → 存句柄，同一临界区完成。文件写为同步 IO，不跨 await。
    {
        let ctrl = app.state::<ControlHandle>();
        let mut st = ctrl.0.lock().unwrap();
        if st.next_gen != generation {
            // 已被更新的一代抢先：本代自我超代，放弃（不写文件、不存句柄）。
            drop(st);
            task.abort();
            return Err("外部控制启动被更新的一次启动取代".into());
        }
        if let Err(e) = write_control_file(&app, port, &token) {
            drop(st);
            task.abort();
            // 写失败：清掉可能残留的上一代文件（本代 section 1 已 abort 上一代 server 但未删其文件），
            // 守「文件存在 ⟺ 端口在监听」——此刻无监听，故不应有文件。
            delete_control_file(&app);
            return Err(e);
        }
        st.running = Some(Running { generation, abort: task });
    }
    Ok(ControlInfo { port, generation })
}

/// 停 server：代际安全（见 stop_matches）。命中才 abort + 删 control.json。
/// generation=None（force）用于无条件停（如启动清理）；前端 toggle/补偿传自己那一代的号。
#[tauri::command]
pub fn stop_external_control(app: AppHandle, generation: Option<u64>) -> Result<(), String> {
    let ctrl = app.state::<ControlHandle>();
    let mut st = ctrl.0.lock().unwrap();
    let current = st.running.as_ref().map(|r| r.generation);
    if stop_matches(current, generation) {
        if let Some(r) = st.running.take() {
            r.abort.abort();
        }
        drop(st);
        delete_control_file(&app);
    }
    Ok(())
}

/// webview 处理完一条请求后回执，唤醒对应 HTTP handler。
#[tauri::command]
pub fn external_control_reply(app: AppHandle, id: String, status: u16, body: String) -> Result<(), String> {
    if let Some(tx) = app.state::<PendingReplies>().0.lock().unwrap().remove(&id) {
        let _ = tx.send(Reply { status, body });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{check_token, stop_matches};
    #[test]
    fn token_matches_only_when_equal() {
        assert!(check_token("abc", Some("abc")));
        assert!(!check_token("abc", Some("xyz")));
        assert!(!check_token("abc", None));
    }
    #[test]
    fn stop_matches_semantics() {
        assert!(stop_matches(Some(2), None));      // force：恒停
        assert!(stop_matches(None, None));         // force：无运行也算命中（用于清理）
        assert!(stop_matches(Some(2), Some(2)));   // 代际匹配 → 停
        assert!(!stop_matches(Some(2), Some(1)));  // 旧代际请求 → 不动当前（新）代际
        assert!(!stop_matches(None, Some(1)));     // 无运行 → 指定代际不匹配
    }
}
