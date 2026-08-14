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

/// 请求体上限。UTF-8 中文约 3 字节/字，16 MiB ≈ 560 万汉字——任何真实作品的单个文件都远够
/// （`writeFile` 是整文件覆写，故这是单文件额度），同时仍是有效防呆边界，挡住本机进程误发
/// GB 级 body 打爆内存。**防呆值不是性能承诺**：几 MiB 的单文件在编辑器组件里本就会卡。
/// **单一真相源在此**——CLI 侧不复制该常量，超限一律靠服务端 413 报出（见 spec §4）。
pub const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

/// 请求体的三态判定。
pub enum BodyOutcome {
    /// 解析成功。空 body → `Value::Null`（GET 无 body 走这条）。
    Ok(serde_json::Value),
    /// 超过 `MAX_BODY_BYTES`（或读取中断）。
    TooLarge,
    /// 非空但不是合法 JSON。
    BadJson,
}

/// 纯函数：把「读 body 的结果」判成三态，供 `proxy` 分流；可脱离 axum / Tauri 单测。
/// 入参 `None` 表示调用方的 `to_bytes` 已判超限。
///
/// 三态**必须各自可辨**。这里曾是 `unwrap_or_else(|_| Bytes::new())` 加 `unwrap_or(Null)`，
/// 把「超限」与「坏 JSON」双双降级成空 body，于是两者都一路走到 webview 的
/// 「缺少命令名 name」——报出的原因与真实原因毫无关系，作者只会以为命令拼错了。
/// 这与 CLI 侧 T106 / T108 堵的是同一类缺陷：失败绝不能伪装成另一种失败。
pub fn classify_body(bytes: Option<&[u8]>) -> BodyOutcome {
    let Some(b) = bytes else { return BodyOutcome::TooLarge };
    if b.is_empty() {
        return BodyOutcome::Ok(serde_json::Value::Null);
    }
    match serde_json::from_slice(b) {
        Ok(v) => BodyOutcome::Ok(v),
        Err(_) => BodyOutcome::BadJson,
    }
}

/// 统一的错误响应：JSON 体 `{ok:false,error}`，与命令失败回的形状一致。
/// 回纯文本的话客户端 `r.json()` 会抛，真实原因当场丢失——token 不匹配因此曾被报成
/// 「端口可能已变，请重开外部控制」，把人引向完全无关的操作。
fn err_json(status: StatusCode, msg: &str) -> axum::response::Response {
    (
        status,
        [("content-type", "application/json")],
        serde_json::json!({ "ok": false, "error": msg }).to_string(),
    )
        .into_response()
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
        return err_json(
            StatusCode::UNAUTHORIZED,
            "鉴权失败：x-kiny-token 不匹配。控制文件可能已过期——请在 editor 设置里关掉再开启「启用外部控制」。",
        );
    }
    // 读 body（POST /command 为 JSON；GET 为空）。超限与坏 JSON 各自报到点上，绝不降级成空 body。
    let read = axum::body::to_bytes(req.into_body(), MAX_BODY_BYTES).await;
    let body = match classify_body(read.as_ref().ok().map(|b| b.as_ref())) {
        BodyOutcome::Ok(v) => v,
        BodyOutcome::TooLarge => {
            // 额度由常量算出，不写死在文案里：两处真相源的话，改了常量文案就无声说谎。
            return err_json(
                StatusCode::PAYLOAD_TOO_LARGE,
                &format!(
                    "请求体过大：超过 {} MiB 上限（也可能是传输中断）。单个文件请控制在此之内，或拆分到多个文件。",
                    MAX_BODY_BYTES / 1024 / 1024
                ),
            )
        }
        BodyOutcome::BadJson => {
            return err_json(StatusCode::BAD_REQUEST, "请求体不是合法 JSON。")
        }
    };

    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<Reply>();
    cx.app.state::<PendingReplies>().0.lock().unwrap().insert(id.clone(), tx);

    // T038 起编辑器是独立的 'editor' 窗口（启动窗是 'launch'，无 'main'）；外部控制驱动的是
    // 跑 useExternalControl 的编辑窗。emit 为全局广播，编辑窗监听器照样收到；此处仅守「编辑窗存在」。
    if cx.app.get_webview_window("editor").is_none() {
        cx.app.state::<PendingReplies>().0.lock().unwrap().remove(&id);
        return err_json(StatusCode::SERVICE_UNAVAILABLE, "editor 窗口尚未就绪（可能仍在启动）。");
    }
    let _ = cx.app.emit("external-control://request", ExternalRequest { id: id.clone(), method, path, body });

    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(reply)) => (StatusCode::from_u16(reply.status).unwrap_or(StatusCode::OK),
                          [("content-type", "application/json")], reply.body).into_response(),
        _ => {
            cx.app.state::<PendingReplies>().0.lock().unwrap().remove(&id);
            err_json(StatusCode::GATEWAY_TIMEOUT, "editor 未在 30 秒内回执（命令可能仍在执行，或 editor 无响应）。")
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
    use super::{check_token, classify_body, stop_matches, BodyOutcome, MAX_BODY_BYTES};

    #[test]
    fn body_limit_is_16_mib() {
        // 上限被无声收紧 / 放大时当场失败。CLI 侧不复制这个常量（单一真相源在此），
        // 故它变化时唯一的护栏就是这条断言 + spec。
        assert_eq!(MAX_BODY_BYTES, 16 * 1024 * 1024);
        // 413 文案用整数除法算 MiB：常量若改成非整 MiB（如 512 KiB）会打出「超过 0 MiB」，
        // 比硬编码还糟。改上限时这条会提醒一并改文案的单位。
        assert_eq!(MAX_BODY_BYTES % (1024 * 1024), 0, "上限须是整 MiB，否则 413 文案会打出 0 MiB");
    }

    #[test]
    fn classify_body_parses_valid_json() {
        match classify_body(Some(br#"{"name":"writeFile"}"#)) {
            BodyOutcome::Ok(v) => assert_eq!(v["name"], "writeFile"),
            _ => panic!("合法 JSON 应解析成 Ok"),
        }
    }

    #[test]
    fn classify_body_empty_is_null_not_error() {
        // GET 请求无 body：既有语义是 Value::Null 照常转发，不能被当成坏请求。
        match classify_body(Some(b"")) {
            BodyOutcome::Ok(v) => assert!(v.is_null()),
            _ => panic!("空 body 应是 Ok(Null)"),
        }
    }

    #[test]
    fn classify_body_none_is_too_large() {
        // None = 调用方的 to_bytes 已判超限。曾经这一路被 unwrap_or_else 换成空字节串，
        // 于是超限的请求一路走到「缺少命令名 name」——与真实原因毫无关系的错误。
        assert!(matches!(classify_body(None), BodyOutcome::TooLarge));
    }

    /// `classify_body(None)` 的**前提验证**：跑真的 `axum::body::to_bytes`，确认超过 limit 时
    /// 它确实返回 `Err`、而恰好等于 limit 时成功。
    ///
    /// 上面几条测试都是喂 `None` 假装「调用方已判超限」——若 `to_bytes` 实际行为不是这样
    /// （比如截断而非报错、或 limit 是排他的），整套 413 路径就是空的，而那几条测试照样全绿。
    /// 这是唯一一处真正把假设钉在真实库行为上的测试。
    #[tokio::test]
    async fn to_bytes_errs_beyond_limit_and_succeeds_at_limit() {
        let over = axum::body::to_bytes(
            axum::body::Body::from(vec![b'x'; MAX_BODY_BYTES + 1]),
            MAX_BODY_BYTES,
        )
        .await;
        assert!(over.is_err(), "超出上限时 to_bytes 必须 Err —— 413 路径的整个前提");

        let at = axum::body::to_bytes(
            axum::body::Body::from(vec![b'x'; MAX_BODY_BYTES]),
            MAX_BODY_BYTES,
        )
        .await;
        assert!(at.is_ok(), "恰好等于上限应当放行（limit 是包含的），否则额度少一字节");
        assert_eq!(at.unwrap().len(), MAX_BODY_BYTES);
    }

    #[test]
    fn classify_body_rejects_malformed_json() {
        // 同一个洞的另一半：曾经 unwrap_or(Null) 把坏 JSON 也降级成「缺少命令名 name」。
        assert!(matches!(classify_body(Some(b"{ not json")), BodyOutcome::BadJson));
    }

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
