fn main() {
    // tauri-build 只声明了对 tauri.conf.json 的 rerun-if-changed，不盯图标文件本身。
    // 于是仅替换图标内容（路径不变）时 Cargo 不会重编，导致 exe 仍嵌旧图标。
    // 显式盯住图标清单，图标一变即重跑 build script、重新嵌入。
    for icon in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }
    tauri_build::build()
}
