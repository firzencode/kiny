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

/// 解压 .kip（zip）到 dest 目录。要求 zip 根部直接是 kiny.json（不套外层目录）。
pub(crate) fn extract_zip(kip: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(kip).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "不是合法的 zip / .kip".to_string())?;
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

/// 读 dir/kiny.json，校验四个必需字段非空 + entry 文件存在；返回展示元数据。
/// 与 engine validateManifest 等价的结构校验（engine 的权威 analyze 留到打开时在前端跑）。
pub(crate) fn read_meta(dir: &Path) -> Result<StoryEntry, String> {
    let text = fs::read_to_string(dir.join("kiny.json")).map_err(|_| "缺少 kiny.json".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| "kiny.json 不是合法 JSON".to_string())?;
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

#[tauri::command]
pub fn import_kip(app: tauri::AppHandle, kip_path: String) -> Result<StoryEntry, String> {
    let lib = library_dir(&app)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let tmp = lib.join(format!(".tmp-{id}"));
    let dest = lib.join(&id);
    if let Err(e) = extract_zip(Path::new(&kip_path), &tmp) {
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;

    /// 在内存构造一个 .kip（zip）写到 path，含给定 (相对路径, 内容) 条目。
    fn make_kip(path: &Path, entries: &[(&str, &str)]) {
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
        fs::write(path, &buf).unwrap();
    }

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("kiny-test-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    const GOOD_MANIFEST: &str = r#"{"name":"雾港之夜","version":"1.0.0","engine":"0.1.0","entry":"main.kin","author":"佚名","cover":"assets/c.jpg","description":"测试"}"#;

    #[test]
    fn extract_then_read_meta_ok() {
        let work = tmp();
        let kip = work.join("a.kip");
        make_kip(&kip, &[("kiny.json", GOOD_MANIFEST), ("main.kin", "=== 开场\n你好")]);
        let dest = work.join("out");
        extract_zip(&kip, &dest).unwrap();
        let m = read_meta(&dest).unwrap();
        assert_eq!(m.name, "雾港之夜");
        assert_eq!(m.author.as_deref(), Some("佚名"));
        assert_eq!(m.cover.as_deref(), Some("assets/c.jpg"));
    }

    #[test]
    fn missing_kiny_json_rejected() {
        let work = tmp();
        let kip = work.join("b.kip");
        make_kip(&kip, &[("main.kin", "=== 开场\n你好")]);
        let dest = work.join("out");
        extract_zip(&kip, &dest).unwrap();
        assert!(read_meta(&dest).is_err());
    }

    #[test]
    fn missing_entry_file_rejected() {
        let work = tmp();
        let kip = work.join("c.kip");
        make_kip(&kip, &[("kiny.json", GOOD_MANIFEST)]); // 无 main.kin
        let dest = work.join("out");
        extract_zip(&kip, &dest).unwrap();
        let err = read_meta(&dest).unwrap_err();
        assert!(err.contains("入口"));
    }

    #[test]
    fn bad_manifest_field_rejected() {
        let work = tmp();
        let kip = work.join("d.kip");
        make_kip(&kip, &[("kiny.json", r#"{"name":"","version":"1","engine":"0.1.0","entry":"main.kin"}"#), ("main.kin", "x")]);
        let dest = work.join("out");
        extract_zip(&kip, &dest).unwrap();
        assert!(read_meta(&dest).is_err());
    }

    #[test]
    fn missing_entry_field_rejected() {
        let work = tmp();
        let kip = work.join("e.kip");
        // kiny.json 无 entry 字段
        make_kip(&kip, &[("kiny.json", r#"{"name":"x","version":"1","engine":"0.1.0"}"#), ("main.kin", "x")]);
        let dest = work.join("out");
        extract_zip(&kip, &dest).unwrap();
        let err = read_meta(&dest).unwrap_err();
        assert!(err.contains("entry"));
    }

    #[test]
    fn zip_slip_entry_skipped() {
        let work = tmp();
        let kip = work.join("slip.kip");
        make_kip(&kip, &[("kiny.json", GOOD_MANIFEST), ("main.kin", "x"), ("../evil.txt", "pwned")]);
        let dest = work.join("out");
        extract_zip(&kip, &dest).unwrap();
        // enclosed_name() 拦截越界条目：dest 的父目录下不应出现 evil.txt
        assert!(!dest.parent().unwrap().join("evil.txt").exists());
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
}
