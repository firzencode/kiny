mod kip;
#[cfg(windows)]
mod webview2;

use std::sync::Mutex;

/// 被「打开 / 分享 .kip」意图拉起时，OS 把文件 url 经 `RunEvent::Opened` 交付。
/// 冷启动时 UI 尚未加载，先把 url 暂存这里，前端就绪后经 `opened_urls` 命令取回。
struct OpenedUrls(Mutex<Vec<tauri::Url>>);

/// 冷启动取回暂存的「待导入」url（前端 mount 时调）：取一次即清空，使「取一次」语义成真
/// ——webview remount / React StrictMode 双调 effect 时不会重复返回旧 url 再次导入。桌面返回空。
#[tauri::command]
fn opened_urls(app: tauri::AppHandle) -> Vec<tauri::Url> {
    use tauri::Manager;
    std::mem::take(&mut *app.state::<OpenedUrls>().0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 建窗口前先确认 WebView2 运行时可用（免安装 portable 版受益；安装版无害）。
    #[cfg(windows)]
    webview2::ensure_or_exit();

    tauri::Builder::default()
        .manage(OpenedUrls(Mutex::new(vec![])))
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
        // Android content:// 字节读取（桌面为 no-op，命令在非 android 返回 NOT_ANDROID）。
        .plugin(tauri_plugin_android_fs::init())
        .setup(|_app| {
            // 启动行：定位版本 / 平台；Rust 端 panic 也经 log 插件落同一文件。
            log::info!(
                "app started · Kiny 阅读器 v{} · {}",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kip::import_kip_bytes,
            kip::import_kip_uri,
            kip::list_library,
            kip::delete_story,
            kip::list_saves,
            kip::write_save,
            kip::read_save,
            kip::delete_save,
            opened_urls
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // 移动端：被「打开 / 分享 .kip」意图拉起 / 收到新意图时，OS 经 Opened 交付 url。
            // 暂存进 state（供冷启动 opened_urls 取回）并 emit 给前端（热启动即时导入）。
            #[cfg(any(target_os = "android", target_os = "ios", target_os = "macos"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::{Emitter, Manager};
                _app.state::<OpenedUrls>().0.lock().unwrap().extend(urls.clone());
                let _ = _app.emit("opened", urls);
            }
        });
}
