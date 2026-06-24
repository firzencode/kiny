mod kip;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            kip::import_kip,
            kip::list_library,
            kip::delete_story
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
