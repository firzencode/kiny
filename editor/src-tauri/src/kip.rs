use std::fs;
use std::io::Write;
use std::path::Path;
use zip::write::FileOptions;
use zip::ZipWriter;

/// 把 src 目录递归打包成 .kip（zip）写到 dest。
/// 文件以「相对 src、'/' 分隔」的路径入 zip——manifest（`<名>.kiw` 或旧 kiny.json）自然落在根部，满足 reader 契约。
/// 跳过以 '.' 开头的隐藏项与扩展名为 kip 的文件（防把上次导出的包打进新包）。
///
/// 中途失败即删掉半成品：`ZipWriter` 出错时不会写出 central directory，留在磁盘上的就是一个
/// 打不开的半截 zip——用户看到文件在就以为导出成功，拿去 reader 才发现「不是合法的 zip / .kip」。
fn zip_dir(src: &Path, dest: &Path) -> Result<(), String> {
    let r = write_zip(src, dest);
    if r.is_err() {
        let _ = fs::remove_file(dest);
    }
    r
}

fn write_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zw = ZipWriter::new(file);
    let opts: FileOptions<()> = FileOptions::default();
    add_dir(&mut zw, src, src, &opts)?;
    zw.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn add_dir<W: Write + std::io::Seek>(
    zw: &mut ZipWriter<W>,
    root: &Path,
    dir: &Path,
    opts: &FileOptions<()>,
) -> Result<(), String> {
    for ent in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue; // 隐藏项
        }
        let path = ent.path();
        if path.is_dir() {
            if crate::webpage::is_export_dir(&path) {
                continue; // 「导出独立网页」的产物：项目内容的一份副本，打进去只会让包体积翻倍
            }
            add_dir(zw, root, &path, opts)?;
        } else {
            if path.extension().and_then(|x| x.to_str()) == Some("kip") {
                continue; // 跳过 .kip
            }
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
            let rel = rel.to_string_lossy().replace('\\', "/");
            zw.start_file(rel, *opts).map_err(|e| e.to_string())?;
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            zw.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn export_kip(dir: String, dest: String) -> Result<(), String> {
    zip_dir(Path::new(&dir), Path::new(&dest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::path::PathBuf;

    fn tmp() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("kiny-editor-test-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn export_packs_relative_paths_skipping_kip_and_hidden() {
        let src = tmp();
        fs::write(
            src.join("kiny.json"),
            r#"{"name":"x","version":"1.0.0","engine":"0.1.0","entry":"main.kin"}"#,
        )
        .unwrap();
        fs::write(src.join("main.kin"), "=== 开场\n你好").unwrap();
        fs::create_dir_all(src.join("assets")).unwrap();
        fs::write(src.join("assets/c.bin"), [0u8, 1, 2, 255]).unwrap();
        fs::write(src.join("prev.kip"), "OLD").unwrap(); // 应跳过
        fs::write(src.join(".secret"), "hidden").unwrap(); // 应跳过

        let dest = tmp().join("out.kip");
        export_kip(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        let f = fs::File::open(&dest).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let mut names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "assets/c.bin".to_string(),
                "kiny.json".to_string(),
                "main.kin".to_string(),
            ]
        );

        let mut e = zip.by_name("assets/c.bin").unwrap();
        let mut buf = Vec::new();
        e.read_to_end(&mut buf).unwrap();
        assert_eq!(buf, vec![0u8, 1, 2, 255]);
    }

    #[test]
    fn export_skips_marked_export_dir() {
        // 「导出独立网页」的产物目录（带 .kiny-export 标记）不进 .kip：它只是项目内容的一份副本，
        // 打进去既让包体积翻倍，也会在解包后的项目里带一份陈旧网页。
        let src = tmp();
        fs::write(
            src.join("故事.kiw"),
            r#"{"name":"故事","version":"1.0.0","engine":"0.13.0","entry":"main.kin"}"#,
        )
        .unwrap();
        fs::write(src.join("main.kin"), "=== 开场\n你好").unwrap();
        fs::create_dir_all(src.join("故事-web")).unwrap();
        fs::write(src.join("故事-web").join(crate::webpage::EXPORT_MARKER), "").unwrap();
        fs::write(src.join("故事-web/index.html"), "<html>").unwrap();
        fs::write(src.join("故事-web/theme.css"), "旧").unwrap();

        let dest = tmp().join("out.kip");
        export_kip(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        let f = fs::File::open(&dest).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let mut names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["main.kin".to_string(), "故事.kiw".to_string()]);
    }

    #[test]
    fn export_removes_half_written_kip_on_failure() {
        // 打包中途失败（读不到目录 / 路径超长等）时 ZipWriter 从未 finish，磁盘上会留下一个
        // 没有 central directory 的半截 zip——看着像导出成功，reader 却只能报「不是合法的 zip」。
        let dest = tmp().join("out.kip");
        let missing = tmp().join("不存在的项目");
        let err = export_kip(
            missing.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(!err.is_empty());
        assert!(!dest.exists(), "打包失败不得留下半截 .kip");
    }

    #[test]
    fn export_packs_kiw_manifest_at_zip_root() {
        let src = tmp();
        fs::write(
            src.join("雾港之夜.kiw"),
            r#"{"name":"雾港之夜","version":"1.0.0","engine":"0.4.0","entry":"main.kin"}"#,
        )
        .unwrap();
        fs::write(src.join("main.kin"), "=== 开场\n你好").unwrap();

        let dest = tmp().join("out.kip");
        export_kip(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        let f = fs::File::open(&dest).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        // manifest .kiw 落在 zip 根部（无外层目录），reader 解包端 locate_manifest 才挑得到。
        assert!(names.contains(&"雾港之夜.kiw".to_string()));
    }
}
