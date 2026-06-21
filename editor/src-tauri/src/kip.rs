use std::fs;
use std::io::Write;
use std::path::Path;
use zip::write::FileOptions;
use zip::ZipWriter;

/// 把 src 目录递归打包成 .kip（zip）写到 dest。
/// 文件以「相对 src、'/' 分隔」的路径入 zip——kiny.json 自然落在根部，满足 reader 契约。
/// 跳过以 '.' 开头的隐藏项与扩展名为 kip 的文件（防把上次导出的包打进新包）。
fn zip_dir(src: &Path, dest: &Path) -> Result<(), String> {
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
}
