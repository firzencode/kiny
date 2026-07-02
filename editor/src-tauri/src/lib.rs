mod kip;
mod webpage;
#[cfg(windows)]
mod webview2;

use std::sync::Mutex;

/// 从命令行参数里挑出 `.kiw` 项目文件路径（跳过程序名）。
#[cfg(desktop)]
fn kiw_arg(argv: &[String]) -> Option<String> {
    argv.iter().skip(1).find(|a| a.ends_with(".kiw")).cloned()
}

/// 冷启动待打开的 `.kiw` 路径：OS 双击首次拉起时在 setup 期暂存，前端 mount 后主动取走。
/// 规避 setup 期 emit 早于前端 listener 注册的竞态（热启动的转发走 single-instance 回调、listener 已在，仍走 emit）。
#[derive(Default)]
struct LaunchProject(Mutex<Option<String>>);

/// 前端 mount 后调用：取走并清空冷启动待打开路径（无则 None）。
#[tauri::command]
fn take_launch_project(state: tauri::State<'_, LaunchProject>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

/// 动态放行一个项目目录树：让 plugin-fs（读写 .kin / manifest）与 asset 协议（预览图片/音频）
/// 能访问该目录，不再被 capabilities 静态 `$HOME/**` 作用域锁死。
/// 只授权用户经对话框显式打开 / 新建的项目目录（连同子树），故编辑器可打开任意盘符位置的项目，
/// 又不盲目全盘放行。前端在 readProject / newProject 触及某目录前调用。
#[tauri::command]
fn allow_project_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    let path = std::path::Path::new(&dir);
    app.fs_scope().allow_directory(path, true).map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 建窗口前先确认 WebView2 运行时可用（免安装 portable 版受益；安装版无害）。
    #[cfg(windows)]
    webview2::ensure_or_exit();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // 单实例（桌面）：双击 .kiw 拉起时若已运行 → 聚焦现窗口 + 从转发的 argv 解析 .kiw → emit 给前端。
    // 必须最先注册（Tauri 文档要求 single-instance 尽早 init）。
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            if let Some(path) = kiw_arg(&argv) {
                let _ = app.emit("open-project-file", path);
            }
        }));
    }

    builder
        .manage(LaunchProject(Mutex::new(None)))
        // 运行时错误收集：日志插件 release 也启用，写 appLogDir、单文件 5MB 轮转、保留当前+1 归档。
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("kiny".into()) },
                ))
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            kip::export_kip,
            webpage::export_webpage,
            take_launch_project,
            allow_project_dir
        ])
        .setup(|_app| {
            // 启动行：定位版本 / 平台；Rust 端 panic 也经 log 插件落同一文件。
            log::info!(
                "app started · Kiny 编辑器 v{} · {}",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS
            );
            // 冷启动（OS 双击 .kiw 首次拉起）：命令行参数带 .kiw → 暂存 state，前端 mount 后 take_launch_project 取走
            // （不 emit：setup 期前端 listener 尚未注册，emit 会丢）。
            #[cfg(desktop)]
            {
                use tauri::Manager;
                if let Some(path) = kiw_arg(&std::env::args().collect::<Vec<_>>()) {
                    if let Ok(mut g) = _app.state::<LaunchProject>().0.lock() {
                        *g = Some(path);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
