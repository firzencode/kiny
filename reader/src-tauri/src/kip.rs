use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Clone, Debug)]
pub struct StoryEntry {
    pub id: String,
    pub dir: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub description: Option<String>,
}

/// 合法 story id = uuid simple 形态：非空且全为 ASCII 十六进制字符。
/// 这同时杜绝目录穿越——"." / ".." / "/" / "\\" 都含非 hex 字符或为空。
pub(crate) fn is_valid_story_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// 解压 .kip（zip）到 dest 目录的核心：从任意 reader（文件或内存字节）读 zip。
/// 要求 zip 根部直接是 manifest（`<名>.kiw` 或旧 kiny.json），不套外层目录。
pub(crate) fn extract_zip_reader<R: std::io::Read + std::io::Seek>(reader: R, dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| "不是合法的 zip / .kip".to_string())?;
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let rel = match entry.enclosed_name() { Some(p) => p, None => continue }; // 防 zip-slip
        let out = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            let mut f = fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut f).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 从目录根挑 manifest 文件名（复刻 engine findManifest，Rust 不能共享 TS）：
/// 恰一个 `.kiw` → 它；零 `.kiw` 但有 `kiny.json` → `kiny.json`（兼容存量 .kip）；否则 Err。
pub(crate) fn locate_manifest(dir: &Path) -> Result<String, String> {
    let mut kiws: Vec<String> = Vec::new();
    let mut has_legacy = false;
    for ent in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let Ok(ent) = ent else { continue };
        if !ent.path().is_file() {
            continue;
        }
        let name = ent.file_name().to_string_lossy().into_owned();
        if name.ends_with(".kiw") {
            kiws.push(name);
        } else if name == "kiny.json" {
            has_legacy = true;
        }
    }
    if kiws.len() > 1 {
        return Err("项目根有多个 .kiw 文件".to_string());
    }
    if let Some(name) = kiws.pop() {
        return Ok(name);
    }
    if has_legacy {
        return Ok("kiny.json".to_string());
    }
    Err("不是 Kiny 项目（缺少 .kiw）".to_string())
}

/// 定位 dir 根的 manifest（`<名>.kiw` 或旧 kiny.json）读之，校验四个必需字段非空 + entry 文件存在；返回展示元数据。
/// 与 engine validateManifest 等价的结构校验（engine 的权威 analyze 留到打开时在前端跑）。
pub(crate) fn read_meta(dir: &Path) -> Result<StoryEntry, String> {
    let manifest_name = locate_manifest(dir)?;
    let text = fs::read_to_string(dir.join(&manifest_name)).map_err(|_| format!("缺少 {manifest_name}"))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("{manifest_name} 不是合法 JSON"))?;
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|x| x.to_string()).filter(|x| !x.trim().is_empty());
    let need = |k: &str| get(k).filter(|x| !x.trim().is_empty()).ok_or_else(|| format!("kiny.json 缺少或非法字段: {k}"));
    let name = need("name")?;
    let _ = need("version")?;
    let _ = need("engine")?;
    let entry = need("entry")?;
    if !dir.join(&entry).is_file() {
        return Err(format!("入口文件不存在: {entry}"));
    }
    let id = dir.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
    Ok(StoryEntry {
        id,
        dir: dir.to_string_lossy().into_owned(),
        name,
        author: get("author"),
        cover: get("cover"),
        description: get("description"),
    })
}

/// <appData>/library，确保存在。
fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let lib = base.join("library");
    fs::create_dir_all(&lib).map_err(|e| e.to_string())?;
    Ok(lib)
}

/// 导入核心（不依赖 AppHandle，可单测）：把 reader 里的 .kip 字节解压进 lib 下临时目录、
/// 校验通过才转正为正式 story 目录（uuid 命名），失败清理临时垃圾。桌面/移动端共用同一路径。
pub(crate) fn import_from_reader<R: std::io::Read + std::io::Seek>(lib: &Path, reader: R) -> Result<StoryEntry, String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let tmp = lib.join(format!(".tmp-{id}"));
    let dest = lib.join(&id);
    if let Err(e) = extract_zip_reader(reader, &tmp) {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    // 先校验临时目录；通过才转正，失败清理临时垃圾
    match read_meta(&tmp) {
        Ok(_) => {
            fs::rename(&tmp, &dest).map_err(|e| {
                let _ = fs::remove_dir_all(&tmp);
                e.to_string()
            })?;
            read_meta(&dest)
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            Err(e)
        }
    }
}

/// 解码 encodeURIComponent 编码的 ASCII 串（%XX → 字节，再按 UTF-8 还原）。
/// 仅用于把前端经 header 传来的原文件名解回，供诊断日志可读。
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let hex = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 导入 .kip（跨平台统一字节入口）：原始字节经 request body 传入（桌面 picker/拖入读到的
/// 文件字节、Android content:// URI 读到的字节都走这里），原文件名经 `x-kip-filename`
/// header（encodeURIComponent 编码）传入仅作诊断。解压/校验/落盘逻辑与路径版等价。
#[tauri::command]
pub fn import_kip_bytes(app: tauri::AppHandle, request: tauri::ipc::Request) -> Result<StoryEntry, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.as_slice(),
        _ => return Err("import_kip_bytes 需要原始字节请求体".to_string()),
    };
    let filename = request
        .headers()
        .get("x-kip-filename")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    log::info!("import_kip_bytes · {filename} · {} bytes", bytes.len());
    let lib = library_dir(&app)?;
    import_from_reader(&lib, std::io::Cursor::new(bytes))
}

/// 导入 .kip（Android `content://` 入口）：plugin-fs 的 readFile 在 Android 读不了 content://
/// （Tauri #9083），故 picker 选中 / 分享·打开意图给的 content:// URI 走这里——经
/// tauri-plugin-android-fs 用 ContentResolver 在原生侧读字节，再复用同一 import_from_reader。
/// 桌面文件系统路径仍走 `import_kip_bytes`（前端 readFile 读字节），不经此入口。
#[tauri::command]
pub fn import_kip_uri(app: tauri::AppHandle, uri: String) -> Result<StoryEntry, String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
        let bytes = app
            .android_fs()
            .read(&FileUri::from_uri(uri))
            .map_err(|e| e.to_string())?;
        log::info!("import_kip_uri · {} bytes", bytes.len());
        let lib = library_dir(&app)?;
        import_from_reader(&lib, std::io::Cursor::new(bytes))
    }
    #[cfg(not(target_os = "android"))]
    {
        // content:// 仅 Android 出现；桌面永不调用此入口（前端按 content:// 前缀分流）。
        let _ = uri;
        let _ = &app;
        Err("import_kip_uri 仅用于 Android content:// URI".to_string())
    }
}

#[tauri::command]
pub fn list_library(app: tauri::AppHandle) -> Result<Vec<StoryEntry>, String> {
    let lib = library_dir(&app)?;
    let mut out = Vec::new();
    for ent in fs::read_dir(&lib).map_err(|e| e.to_string())? {
        let Ok(ent) = ent else { continue };
        let p = ent.path();
        let hidden = p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with('.')).unwrap_or(true);
        if p.is_dir() && !hidden {
            if let Ok(m) = read_meta(&p) { out.push(m); } // 跳过损坏目录
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn delete_story(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !is_valid_story_id(&id) {
        return Err("非法 id".to_string());
    }
    let dir = library_dir(&app)?.join(&id);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    // 连带删该书全部存档（spec §6：删书连带删存档）。
    let saves = app_saves_root(&app)?.join(&id);
    if saves.is_dir() {
        let _ = fs::remove_dir_all(&saves);
    }
    Ok(())
}

// ---------- 存档（save / load） ----------
// 存档独立于 library，落 <appData>/saves/<storyId>/<saveId>.json，按 story id 归档。
// 引擎 / player 的快照与渲染态对 Rust 是不透明 JSON，Rust 只认 save 的 id 当文件名。

/// 合法 save id：自动续读那条恒为 "auto"，手动存档为非空全 ASCII 十六进制（杜绝目录穿越）。
pub(crate) fn is_valid_save_id(id: &str) -> bool {
    id == "auto" || (!id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()))
}

/// <appData>/saves，确保存在。
fn app_saves_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root = base.join("saves");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

/// <appData>/saves/<storyId>，校验 id 后确保存在。
fn saves_dir(app: &tauri::AppHandle, story_id: &str) -> Result<PathBuf, String> {
    if !is_valid_story_id(story_id) {
        return Err("非法 story id".to_string());
    }
    let dir = app_saves_root(app)?.join(story_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// 纯 IO 助手（不依赖 AppHandle，可单测）：

/// 写一条存档到 dir/<id>.json（id 取自 save["id"]，须合法）。
pub(crate) fn write_save_in(dir: &Path, save: &serde_json::Value) -> Result<(), String> {
    let id = save.get("id").and_then(|v| v.as_str()).ok_or("save 缺 id 字段")?;
    if !is_valid_save_id(id) {
        return Err("非法 save id".to_string());
    }
    let text = serde_json::to_string(save).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{id}.json")), text).map_err(|e| e.to_string())
}

/// 列 dir 下全部 .json 存档（解析失败的跳过）。
pub(crate) fn list_saves_in(dir: &Path) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for ent in rd {
        let Ok(ent) = ent else { continue };
        let p = ent.path();
        if p.extension().and_then(|x| x.to_str()) == Some("json") {
            if let Ok(text) = fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    out.push(v);
                }
            }
        }
    }
    out
}

/// 读 dir/<saveId>.json；不存在 → None。
pub(crate) fn read_save_in(dir: &Path, save_id: &str) -> Result<Option<serde_json::Value>, String> {
    if !is_valid_save_id(save_id) {
        return Err("非法 save id".to_string());
    }
    let path = dir.join(format!("{save_id}.json"));
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map(Some).map_err(|e| e.to_string())
}

/// 删 dir/<saveId>.json（不存在视作成功）。
pub(crate) fn delete_save_in(dir: &Path, save_id: &str) -> Result<(), String> {
    if !is_valid_save_id(save_id) {
        return Err("非法 save id".to_string());
    }
    let path = dir.join(format!("{save_id}.json"));
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_saves(app: tauri::AppHandle, story_id: String) -> Result<Vec<serde_json::Value>, String> {
    Ok(list_saves_in(&saves_dir(&app, &story_id)?))
}

#[tauri::command]
pub fn write_save(app: tauri::AppHandle, story_id: String, save: serde_json::Value) -> Result<(), String> {
    write_save_in(&saves_dir(&app, &story_id)?, &save)
}

#[tauri::command]
pub fn read_save(app: tauri::AppHandle, story_id: String, save_id: String) -> Result<Option<serde_json::Value>, String> {
    read_save_in(&saves_dir(&app, &story_id)?, &save_id)
}

#[tauri::command]
pub fn delete_save(app: tauri::AppHandle, story_id: String, save_id: String) -> Result<(), String> {
    delete_save_in(&saves_dir(&app, &story_id)?, &save_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;

    /// 在内存构造一个 .kip（zip）的字节，含给定 (相对路径, 内容) 条目。
    fn make_kip_bytes(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            for (name, content) in entries {
                zw.start_file(*name, opts).unwrap();
                zw.write_all(content.as_bytes()).unwrap();
            }
            zw.finish().unwrap();
        }
        buf
    }

    /// 把 .kip 字节解压到 dest（解压逻辑与生产 import 共用 extract_zip_reader）。
    fn extract_kip(entries: &[(&str, &str)], dest: &Path) -> Result<(), String> {
        extract_zip_reader(Cursor::new(make_kip_bytes(entries)), dest)
    }

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("kiny-test-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    const GOOD_MANIFEST: &str = r#"{"name":"雾港之夜","version":"1.0.0","engine":"0.1.0","entry":"main.kin","author":"佚名","cover":"assets/c.jpg","description":"测试"}"#;

    #[test]
    fn extract_then_read_meta_ok() {
        let dest = tmp().join("out");
        extract_kip(&[("kiny.json", GOOD_MANIFEST), ("main.kin", "=== 开场\n你好")], &dest).unwrap();
        let m = read_meta(&dest).unwrap();
        assert_eq!(m.name, "雾港之夜");
        assert_eq!(m.author.as_deref(), Some("佚名"));
        assert_eq!(m.cover.as_deref(), Some("assets/c.jpg"));
    }

    #[test]
    fn read_meta_locates_kiw() {
        let dest = tmp().join("out");
        extract_kip(&[("雾港之夜.kiw", GOOD_MANIFEST), ("main.kin", "=== 开场\n你好")], &dest).unwrap();
        let m = read_meta(&dest).unwrap();
        assert_eq!(m.name, "雾港之夜");
    }

    #[test]
    fn read_meta_rejects_multiple_kiw() {
        let dest = tmp().join("out");
        extract_kip(&[("a.kiw", GOOD_MANIFEST), ("b.kiw", GOOD_MANIFEST), ("main.kin", "x")], &dest).unwrap();
        let err = read_meta(&dest).unwrap_err();
        assert!(err.contains("多个"));
    }

    #[test]
    fn missing_manifest_rejected() {
        let dest = tmp().join("out");
        extract_kip(&[("main.kin", "=== 开场\n你好")], &dest).unwrap();
        assert!(read_meta(&dest).is_err());
    }

    #[test]
    fn missing_entry_file_rejected() {
        let dest = tmp().join("out");
        extract_kip(&[("kiny.json", GOOD_MANIFEST)], &dest).unwrap(); // 无 main.kin
        let err = read_meta(&dest).unwrap_err();
        assert!(err.contains("入口"));
    }

    #[test]
    fn bad_manifest_field_rejected() {
        let dest = tmp().join("out");
        extract_kip(&[("kiny.json", r#"{"name":"","version":"1","engine":"0.1.0","entry":"main.kin"}"#), ("main.kin", "x")], &dest).unwrap();
        assert!(read_meta(&dest).is_err());
    }

    #[test]
    fn missing_entry_field_rejected() {
        let dest = tmp().join("out");
        // kiny.json 无 entry 字段
        extract_kip(&[("kiny.json", r#"{"name":"x","version":"1","engine":"0.1.0"}"#), ("main.kin", "x")], &dest).unwrap();
        let err = read_meta(&dest).unwrap_err();
        assert!(err.contains("entry"));
    }

    #[test]
    fn zip_slip_entry_skipped() {
        let dest = tmp().join("out");
        extract_kip(&[("kiny.json", GOOD_MANIFEST), ("main.kin", "x"), ("../evil.txt", "pwned")], &dest).unwrap();
        // enclosed_name() 拦截越界条目：dest 的父目录下不应出现 evil.txt
        assert!(!dest.parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn import_from_reader_extracts_validates_and_persists() {
        let lib = tmp();
        let bytes = make_kip_bytes(&[("kiny.json", GOOD_MANIFEST), ("main.kin", "=== 开场\n你好")]);
        let entry = super::import_from_reader(&lib, Cursor::new(bytes)).unwrap();
        assert_eq!(entry.name, "雾港之夜");
        // 落盘：lib 下出现以返回 id 命名的正式目录，含 kiny.json；无遗留 .tmp- 目录。
        let dest = lib.join(&entry.id);
        assert!(dest.join("kiny.json").is_file());
        assert!(dest.join("main.kin").is_file());
        let leftovers: Vec<_> = fs::read_dir(&lib).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "校验通过后不应残留临时目录");
    }

    #[test]
    fn import_from_reader_rejects_non_zip_and_cleans_up() {
        let lib = tmp();
        let err = super::import_from_reader(&lib, Cursor::new(b"not a zip".to_vec())).unwrap_err();
        assert!(err.contains("zip"));
        // 解压失败：lib 下不应残留任何临时目录。
        let leftovers: Vec<_> = fs::read_dir(&lib).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "解压失败后不应残留临时目录");
    }

    #[test]
    fn import_from_reader_rejects_bad_manifest_and_cleans_up() {
        let lib = tmp();
        // 合法 zip，但缺 main.kin 入口 → 校验失败。
        let bytes = make_kip_bytes(&[("kiny.json", GOOD_MANIFEST)]);
        let err = super::import_from_reader(&lib, Cursor::new(bytes)).unwrap_err();
        assert!(err.contains("入口"));
        // 校验失败：转正前清理临时目录，lib 应为空。
        let count = fs::read_dir(&lib).unwrap().count();
        assert_eq!(count, 0, "校验失败后应清理临时目录、不转正");
    }

    #[test]
    fn percent_decode_roundtrips_utf8() {
        // encodeURIComponent("雾港之夜.kip") 的等价编码 → 解回原文。
        assert_eq!(super::percent_decode("%E9%9B%BE%E6%B8%AF.kip"), "雾港.kip");
        // 无编码原样返回；ASCII 文件名不变。
        assert_eq!(super::percent_decode("story.kip"), "story.kip");
        // 残缺的 % 序列不致 panic，原样保留。
        assert_eq!(super::percent_decode("a%2"), "a%2");
    }

    #[test]
    fn valid_story_id_guard() {
        assert!(super::is_valid_story_id("0a1b2c3d4e5f60718293a4b5c6d7e8f9"));
        assert!(!super::is_valid_story_id(""));
        assert!(!super::is_valid_story_id("."));
        assert!(!super::is_valid_story_id(".."));
        assert!(!super::is_valid_story_id("a/b"));
        assert!(!super::is_valid_story_id("..\\x"));
    }

    #[test]
    fn save_id_guard() {
        assert!(super::is_valid_save_id("auto"));
        assert!(super::is_valid_save_id("deadbeef0a1b2c3d"));
        assert!(!super::is_valid_save_id(""));
        assert!(!super::is_valid_save_id("../x"));
        assert!(!super::is_valid_save_id("a b"));
        assert!(!super::is_valid_save_id("auto2")); // 非 hex、又不等于 "auto"
    }

    #[test]
    fn save_write_list_read_delete_roundtrip() {
        let dir = tmp();
        let auto = serde_json::json!({"id":"auto","kind":"auto","snapshot":{"fingerprint":"fp"},"play":{},"meta":{"timestamp":1,"label":"开场"}});
        let manual = serde_json::json!({"id":"deadbeef","kind":"manual","snapshot":{},"play":{},"meta":{"timestamp":2,"label":"码头"}});
        super::write_save_in(&dir, &auto).unwrap();
        super::write_save_in(&dir, &manual).unwrap();
        assert_eq!(super::list_saves_in(&dir).len(), 2);
        let got = super::read_save_in(&dir, "auto").unwrap().unwrap();
        assert_eq!(got["meta"]["label"], "开场");
        super::delete_save_in(&dir, "auto").unwrap();
        assert!(super::read_save_in(&dir, "auto").unwrap().is_none());
        assert_eq!(super::list_saves_in(&dir).len(), 1);
    }

    #[test]
    fn write_save_rejects_bad_id() {
        let dir = tmp();
        let bad = serde_json::json!({"id":"../evil","kind":"manual"});
        assert!(super::write_save_in(&dir, &bad).is_err());
        // 缺 id 字段也拒。
        assert!(super::write_save_in(&dir, &serde_json::json!({"kind":"manual"})).is_err());
    }
}
