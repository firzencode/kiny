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

/// 解压资源上限（防 zip bomb / 磁盘耗尽）：.kip 是不受信输入，几 KB 的高压缩比包
/// 可解出 GB 级文件写满磁盘（Android 上更易打爆应用私有存储）。
pub(crate) struct ZipLimits {
    pub max_entries: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

/// 默认上限：足够容纳含音视频素材的大型故事包，又能挡住恶意构造。
pub(crate) const DEFAULT_ZIP_LIMITS: ZipLimits = ZipLimits {
    max_entries: 10_000,
    max_file_bytes: 256 * 1024 * 1024,  // 单文件 256MB
    max_total_bytes: 512 * 1024 * 1024, // 解压总量 512MB
};

/// 解压 .kip（zip）到 dest 目录的核心：从任意 reader（文件或内存字节）读 zip，按默认上限设防。
/// 要求 zip 根部直接是 manifest（`<名>.kiw` 或旧 kiny.json），不套外层目录。
pub(crate) fn extract_zip_reader<R: std::io::Read + std::io::Seek>(reader: R, dest: &Path) -> Result<(), String> {
    extract_zip_reader_limited(reader, dest, &DEFAULT_ZIP_LIMITS)
}

/// 上限参数化的解压实现（单测用小上限验证）。用 `Read::take` 限量拷贝而非信任
/// zip 头部声明的 size——声明值可造假。超限即 Err，交调用方（import_from_reader）清理临时目录。
pub(crate) fn extract_zip_reader_limited<R: std::io::Read + std::io::Seek>(
    reader: R, dest: &Path, limits: &ZipLimits,
) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| "不是合法的 zip / .kip".to_string())?;
    if archive.len() > limits.max_entries {
        return Err(format!("包内条目过多（{} > 上限 {}），拒绝解压", archive.len(), limits.max_entries));
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let rel = match entry.enclosed_name() { Some(p) => p, None => continue }; // 防 zip-slip
        let out = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            let mut f = fs::File::create(&out).map_err(|e| e.to_string())?;
            // 允许写入量 = min(单文件上限, 总量剩余)；多 take 1 字节用于探测超限。
            let allowed = limits.max_file_bytes.min(limits.max_total_bytes.saturating_sub(total));
            let copied = std::io::copy(&mut std::io::Read::take(&mut entry, allowed + 1), &mut f)
                .map_err(|e| e.to_string())?;
            if copied > allowed {
                return Err("解压体积超出上限（疑似 zip bomb），拒绝导入".to_string());
            }
            total += copied;
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

/// manifest 校验产物：四必需字段 + 三可选展示字段（去空白后非空才计入可选字段）。
pub(crate) struct ManifestMeta {
    pub name: String,
    pub entry: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub description: Option<String>,
}

/// 取 manifest 字段的「去空白后非空字符串」值，否则 None（空串 / 非字符串 / 缺失都视作无）。
fn manifest_str(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()).filter(|s| !s.trim().is_empty())
}

/// 校验 manifest 四必需字段非空（复刻 engine `validateManifest` 的结构校验，防两端规则漂移；
/// 跨语言 fixture `engine/src/project/manifest-fixtures.json` 守此等价性）。
/// 注：engine 版一次收齐全部缺失字段，本版报**首个**缺失即返回——两端「是否合法」判定须一致，
/// 错误**消息**不要求逐字相同（fixture 只断言 ok/name 同判，错误只断言两端都 reject）。
pub(crate) fn validate_manifest(v: &serde_json::Value, manifest_name: &str) -> Result<ManifestMeta, String> {
    if !v.is_object() {
        return Err(format!("{manifest_name} 不是 JSON 对象"));
    }
    let need = |k: &str| manifest_str(v, k).ok_or_else(|| format!("{manifest_name} 缺少或非法字段: {k}"));
    // 按 name→version→engine→entry 顺序校验（首个缺失即返回）；version/engine 展示态用不到值，仅校验非空。
    let name = need("name")?;
    let _ = need("version")?;
    let _ = need("engine")?;
    let entry = need("entry")?;
    Ok(ManifestMeta {
        name,
        entry,
        author: manifest_str(v, "author"),
        cover: manifest_str(v, "cover"),
        description: manifest_str(v, "description"),
    })
}

/// 定位 dir 根的 manifest（`<名>.kiw` 或旧 kiny.json）读之，校验四个必需字段非空 + entry 文件存在；返回展示元数据。
/// 与 engine validateManifest 等价的结构校验（engine 的权威 analyze 留到打开时在前端跑）。
pub(crate) fn read_meta(dir: &Path) -> Result<StoryEntry, String> {
    let manifest_name = locate_manifest(dir)?;
    let text = fs::read_to_string(dir.join(&manifest_name)).map_err(|_| format!("缺少 {manifest_name}"))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("{manifest_name} 不是合法 JSON"))?;
    let meta = validate_manifest(&v, &manifest_name)?;
    if !dir.join(&meta.entry).is_file() {
        return Err(format!("入口文件不存在: {}", meta.entry));
    }
    let id = dir.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
    Ok(StoryEntry {
        id,
        dir: dir.to_string_lossy().into_owned(),
        name: meta.name,
        author: meta.author,
        cover: meta.cover,
        description: meta.description,
    })
}

/// <appData>/library，确保存在。
fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let lib = base.join("library");
    fs::create_dir_all(&lib).map_err(|e| e.to_string())?;
    Ok(lib)
}

/// 清扫库目录里遗留的 `.tmp-*` 临时导入目录（启动期调）。正常导入成功会 rename 转正、
/// 失败会 remove，故还残留的 `.tmp-*` 必是导入中途进程被 OS 杀死（Android LMK）留下的
/// 半成品——磁盘垃圾且 list_library 因 `.` 前缀隐藏规则永远跳过它，只能在此清扫。
pub(crate) fn clean_stale_tmp_dirs(lib: &Path) {
    let Ok(rd) = fs::read_dir(lib) else { return };
    for ent in rd {
        let Ok(ent) = ent else { continue };
        let p = ent.path();
        let is_tmp = p
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with(".tmp-"))
            .unwrap_or(false);
        if is_tmp && p.is_dir() {
            let _ = fs::remove_dir_all(&p);
        }
    }
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

/// 从磁盘路径流式导入 .kip（不依赖 AppHandle，可单测）：Rust 侧 `File::open` 直接读，
/// 经 `BufReader` 喂 zip 解包——字节从磁盘流式进来，不在 JS 堆/IPC 上驻留整包（消大包内存峰值）。
/// 桌面 picker/拖入拿到的是真实文件系统路径，故不再需要 webview 持有 `fs:allow-read-file` 权限。
pub(crate) fn import_from_path(lib: &Path, path: &Path) -> Result<StoryEntry, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    import_from_reader(lib, std::io::BufReader::new(file))
}

/// 导入 .kip（桌面文件系统路径入口）：前端把 picker/拖入拿到的路径传进来，Rust 侧流式读、
/// 解压/校验/落盘逻辑与 Android URI 版共用 import_from_reader。Android content:// 走 import_kip_uri。
#[tauri::command]
pub fn import_kip_path(app: tauri::AppHandle, path: String) -> Result<StoryEntry, String> {
    let p = Path::new(&path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    log::info!("import_kip_path · {name}");
    let lib = library_dir(&app)?;
    import_from_path(&lib, p)
}

/// 导入 .kip（Android `content://` 入口）：plugin-fs 的 readFile 在 Android 读不了 content://
/// （Tauri #9083），故 picker 选中 / 分享·打开意图给的 content:// URI 走这里——经
/// tauri-plugin-android-fs 用 ContentResolver 在原生侧读字节，再复用同一 import_from_reader。
/// 桌面文件系统路径走 `import_kip_path`（前端只传路径、Rust 流式读），不经此入口。
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
/// 原子写：先写 <id>.json.tmp 再同目录 rename——auto 存档的使命就是抗崩溃续读，
/// 直接覆盖写在掉电/被杀时会截断 JSON，读档侧当「无存档」静默丢进度。
pub(crate) fn write_save_in(dir: &Path, save: &serde_json::Value) -> Result<(), String> {
    let id = save.get("id").and_then(|v| v.as_str()).ok_or("save 缺 id 字段")?;
    if !is_valid_save_id(id) {
        return Err("非法 save id".to_string());
    }
    let text = serde_json::to_string(save).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{id}.json.tmp"));
    let final_path = dir.join(format!("{id}.json"));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    // Windows 上 rename 到已存在路径会失败：先试直接 rename，失败则删旧再 rename
    //（删+改名间的窗口极小，且 tmp 内容完整，最差情形是旧档缺失、绝不会出现半截 JSON）。
    if fs::rename(&tmp, &final_path).is_err() {
        fs::remove_file(&final_path).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &final_path).map_err(|e| e.to_string())?;
    }
    Ok(())
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

/// 扫 saves 根，返回「含 auto 续读存档（auto.json）」的合法 storyId 集合。
/// 供书架一次性探测哪些书可「继续」，替代前端逐本 read_save 的 N+1 IPC。
pub(crate) fn stories_with_auto_save_in(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(root) else { return out };
    for ent in rd {
        let Ok(ent) = ent else { continue };
        let p = ent.path();
        let Some(id) = p.file_name().and_then(|n| n.to_str()) else { continue };
        if p.is_dir() && is_valid_story_id(id) && p.join("auto.json").is_file() {
            out.push(id.to_string());
        }
    }
    out
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
pub fn stories_with_auto_save(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(stories_with_auto_save_in(&app_saves_root(&app)?))
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
    fn bad_field_error_names_actual_manifest() {
        // 字段错误文案须用真实 manifest 文件名（`<名>.kiw`），非硬编码「kiny.json」。
        let dest = tmp().join("out");
        extract_kip(&[("雾港之夜.kiw", r#"{"name":"","version":"1","engine":"0.1.0","entry":"main.kin"}"#), ("main.kin", "x")], &dest).unwrap();
        let err = read_meta(&dest).unwrap_err();
        assert!(err.contains("雾港之夜.kiw"), "错误文案应含真实 manifest 名，实际：{err}");
        assert!(!err.contains("kiny.json"), "不应硬编码 kiny.json，实际：{err}");
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
    fn import_from_path_streams_file_and_persists() {
        // 桌面路径入口：把 .kip 字节先写进磁盘文件，再经 import_from_path 流式读入、解压落盘。
        let lib = tmp();
        let bytes = make_kip_bytes(&[("kiny.json", GOOD_MANIFEST), ("main.kin", "=== 开场\n你好")]);
        let kip_path = tmp().join("雾港.kip");
        fs::write(&kip_path, &bytes).unwrap();
        let entry = super::import_from_path(&lib, &kip_path).unwrap();
        assert_eq!(entry.name, "雾港之夜");
        let dest = lib.join(&entry.id);
        assert!(dest.join("kiny.json").is_file());
        assert!(dest.join("main.kin").is_file());
    }

    #[test]
    fn import_from_path_missing_file_errors_without_leftover() {
        let lib = tmp();
        let err = super::import_from_path(&lib, &lib.join("不存在.kip")).unwrap_err();
        assert!(!err.is_empty());
        // 文件打不开：连临时目录都没建，lib 保持空。
        assert_eq!(fs::read_dir(&lib).unwrap().count(), 0);
    }

    #[test]
    fn clean_stale_tmp_dirs_removes_leftovers_keeps_stories() {
        let lib = tmp();
        // 残留的半成品临时目录 + 一个正常 story 目录。
        fs::create_dir_all(lib.join(".tmp-deadbeef/sub")).unwrap();
        fs::write(lib.join(".tmp-deadbeef/x.kin"), "x").unwrap();
        fs::create_dir_all(lib.join("0a1b2c3d")).unwrap();
        super::clean_stale_tmp_dirs(&lib);
        assert!(!lib.join(".tmp-deadbeef").exists(), "应清掉遗留 .tmp-* 目录");
        assert!(lib.join("0a1b2c3d").is_dir(), "正常 story 目录不受影响");
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

    #[test]
    fn write_save_overwrites_and_leaves_no_tmp() {
        // 原子写（tmp + rename）：覆盖已有存档必须生效（Windows rename 到已存在路径会失败，须处理），
        // 且成功后目录里不残留 .tmp 中间文件。
        let dir = tmp();
        super::write_save_in(&dir, &serde_json::json!({"id":"auto","n":1})).unwrap();
        super::write_save_in(&dir, &serde_json::json!({"id":"auto","n":2})).unwrap();
        let got = super::read_save_in(&dir, "auto").unwrap().unwrap();
        assert_eq!(got["n"], 2, "覆盖写必须生效");
        let residues: Vec<_> = fs::read_dir(&dir).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(residues.is_empty(), "不应残留临时文件");
    }

    #[test]
    fn zip_entry_count_limit_rejected() {
        let dest = tmp().join("out");
        let owned: Vec<(String, String)> = (0..12).map(|i| (format!("f{i}.txt"), "x".to_string())).collect();
        let entries: Vec<(&str, &str)> = owned.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let limits = super::ZipLimits { max_entries: 10, max_file_bytes: 1024, max_total_bytes: 8192 };
        let err = super::extract_zip_reader_limited(Cursor::new(make_kip_bytes(&entries)), &dest, &limits).unwrap_err();
        assert!(err.contains("条目"), "err={err}");
    }

    #[test]
    fn zip_single_file_size_limit_rejected() {
        let dest = tmp().join("out");
        let big = "0".repeat(4096); // 高压缩比内容：几十字节 zip 解出 4KB
        let limits = super::ZipLimits { max_entries: 100, max_file_bytes: 1024, max_total_bytes: 1024 * 1024 };
        let err = super::extract_zip_reader_limited(
            Cursor::new(make_kip_bytes(&[("kiny.json", GOOD_MANIFEST), ("big.bin", &big)])),
            &dest, &limits,
        ).unwrap_err();
        assert!(err.contains("上限"), "err={err}");
    }

    #[test]
    fn zip_total_size_limit_rejected_across_entries() {
        let dest = tmp().join("out");
        let chunk = "0".repeat(2048); // 单文件 2KB 都在单文件限内，累计超总限
        let limits = super::ZipLimits { max_entries: 100, max_file_bytes: 4096, max_total_bytes: 3000 };
        let err = super::extract_zip_reader_limited(
            Cursor::new(make_kip_bytes(&[("a.bin", &chunk), ("b.bin", &chunk)])),
            &dest, &limits,
        ).unwrap_err();
        assert!(err.contains("上限"), "err={err}");
    }

    #[test]
    fn zip_within_limits_ok() {
        let dest = tmp().join("out");
        let limits = super::ZipLimits { max_entries: 100, max_file_bytes: 4096, max_total_bytes: 8192 };
        super::extract_zip_reader_limited(
            Cursor::new(make_kip_bytes(&[("kiny.json", GOOD_MANIFEST), ("main.kin", "=== 开场\n你好")])),
            &dest, &limits,
        ).unwrap();
        assert!(dest.join("main.kin").is_file());
    }

    #[test]
    fn stories_with_auto_save_scans_root() {
        // Q3：书架批量探测——只返回「含 auto.json」的合法 storyId，忽略仅手动存档 / 空目录 / 非法名。
        let root = tmp();
        let sid_a = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"; // 有 auto
        let sid_b = "1111222233334444555566667777888"; // 仅手动
        let sid_c = "aaaabbbbccccddddeeeeffff00001111"; // 空目录
        fs::create_dir_all(root.join(sid_a)).unwrap();
        fs::write(root.join(sid_a).join("auto.json"), "{}").unwrap();
        fs::write(root.join(sid_a).join("deadbeef.json"), "{}").unwrap(); // 混一条手动，仍算有 auto
        fs::create_dir_all(root.join(sid_b)).unwrap();
        fs::write(root.join(sid_b).join("cafef00d.json"), "{}").unwrap();
        fs::create_dir_all(root.join(sid_c)).unwrap();
        fs::create_dir_all(root.join(".tmp-junk")).unwrap(); // 非法名目录（. 前缀）
        fs::write(root.join("loose.txt"), "x").unwrap(); // 根下散文件
        let mut got = super::stories_with_auto_save_in(&root);
        got.sort();
        assert_eq!(got, vec![sid_a.to_string()], "只应返回含 auto.json 的合法 story");
    }

    #[test]
    fn stories_with_auto_save_missing_root_empty() {
        // saves 根不存在 → 空集（不 panic）。
        let root = tmp().join("nope");
        assert!(super::stories_with_auto_save_in(&root).is_empty());
    }

    #[test]
    fn manifest_cross_lang_fixture() {
        use serde_json::Value;
        // 与 engine（engine/src/project/manifest-fixtures.test.ts）读**同一份** fixture，两端对同批样本断言同判——
        // 防 Rust locate_manifest/validate_manifest 与 engine findManifest/validateManifest 规则漂移。
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine/src/project/manifest-fixtures.json");
        let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("读 fixture 失败 {path}: {e}"));
        let fx: Value = serde_json::from_str(&text).unwrap();

        // locate 用例：建临时目录、touch 每个文件名、跑 locate_manifest 判定同 findManifest。
        for c in fx["locate"].as_array().unwrap() {
            let desc = c["desc"].as_str().unwrap();
            let dir = tmp().join("loc");
            fs::create_dir_all(&dir).unwrap();
            for n in c["names"].as_array().unwrap() {
                fs::write(dir.join(n.as_str().unwrap()), b"").unwrap();
            }
            let r = super::locate_manifest(&dir);
            let want_ok = c["ok"].as_bool().unwrap();
            assert_eq!(r.is_ok(), want_ok, "locate 同判失配：{desc} → {r:?}");
            if want_ok {
                assert_eq!(r.unwrap(), c["name"].as_str().unwrap(), "locate name 失配：{desc}");
            }
        }

        // validate 用例：直接跑 validate_manifest（纯字段校验，不涉 entry 文件存在）判定同 validateManifest。
        for c in fx["validate"].as_array().unwrap() {
            let desc = c["desc"].as_str().unwrap();
            let r = super::validate_manifest(&c["raw"], "kiny.json");
            let want_ok = c["ok"].as_bool().unwrap();
            assert_eq!(r.is_ok(), want_ok, "validate 同判失配：{desc}（ok 期望 {want_ok}）");
            if want_ok {
                assert_eq!(r.unwrap().name, c["name"].as_str().unwrap(), "validate name 失配：{desc}");
            }
        }
    }
}
