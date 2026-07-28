use std::fs;
use std::path::Path;
use tauri::{path::BaseDirectory, Manager};

/// 把内联数据注入模板：替换占位字符串 `"__KINY_PROJECT_DATA__"`（含引号）为实际 JSON 文本。
/// project_data 由前端 `buildProjectData` 产出，已是合法 JSON 对象文本，直接整体替换。
fn inject_project_data(template: &str, project_data: &str) -> String {
    template.replace("\"__KINY_PROJECT_DATA__\"", project_data)
}

/// 该文件是否需要拷进导出目录：项目内**全部非 `.kin`、非 manifest** 的文件（css / 字体 / 图片 /
/// 音频 / 任意旁挂资源），保持相对路径。`.kin` 源已内联进 index.html 的项目数据，manifest 同理。
fn should_copy(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !lower.ends_with(".kin") && !lower.ends_with(".kiw") && lower != "kiny.json"
}

/// 递归拷贝项目资源 src → dest：跳过 `.` 开头的项与 node_modules（镜像 .kip 打包与资源发现规则），
/// 跳过 `.kin` / manifest。空目录不产出（只在真有文件落地时建目录）。
fn copy_assets(src: &Path, dest: &Path) -> Result<(), String> {
    for ent in fs::read_dir(src).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = ent.path();
        if path.is_dir() {
            copy_assets(&path, &dest.join(&name))?;
        } else if should_copy(&name) {
            fs::create_dir_all(dest).map_err(|e| e.to_string())?;
            fs::copy(&path, dest.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 导出独立网页：在 parent_dir 下建 folder_name 文件夹，写入注入了 project_data 的 index.html
/// （模板取自打包进 editor 的 Tauri resource，与 viewer 同源），并把项目内**全部非 `.kin`、
/// 非 manifest 的文件**按相对路径拷过去（图片 / 音频 / 未内联的旁挂资源）。返回最终目标文件夹路径。
#[tauri::command]
pub fn export_webpage(
    app: tauri::AppHandle,
    project_dir: String,
    parent_dir: String,
    folder_name: String,
    project_data: String,
) -> Result<String, String> {
    let template_path = app
        .path()
        .resolve("resources/export-template/index.html", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let template = fs::read_to_string(&template_path)
        .map_err(|e| format!("读取导出模板失败（{}）：{e}", template_path.display()))?;
    let html = inject_project_data(&template, &project_data);

    let dest = Path::new(&parent_dir).join(&folder_name);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    // 先拷资源、后写 index.html：项目根若自带 index.html（`.html` 是可编辑资源之一），
    // 反过来就会把导出的页面覆盖掉、导出物打不开。
    // 资源走相对引用：项目内非 .kin / 非 manifest 的文件按原相对路径拷到 dest。
    copy_assets(Path::new(&project_dir), &dest)?;
    fs::write(dest.join("index.html"), html).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("kiny-webpage-test-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn inject_replaces_quoted_placeholder_with_raw_json() {
        let template = r#"<head><script>window.__KINY_PROJECT__ = "__KINY_PROJECT_DATA__";</script></head>"#;
        let data = r#"{"manifest":"{}","files":{"main.kin":"开场"},"assetBase":""}"#;
        let out = inject_project_data(template, data);
        assert!(out.contains(r#"window.__KINY_PROJECT__ = {"manifest":"{}","files":{"main.kin":"开场"},"assetBase":""};"#));
        assert!(!out.contains("__KINY_PROJECT_DATA__"));
    }

    #[test]
    fn inject_noop_when_no_placeholder() {
        let template = "<head></head>";
        assert_eq!(inject_project_data(template, "{}"), "<head></head>");
    }

    #[test]
    fn copy_assets_copies_nested_files() {
        let src = tmp();
        fs::write(src.join("a.jpg"), [1u8, 2, 3]).unwrap();
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub/b.mp3"), [4u8, 5]).unwrap();

        let dest = tmp().join("out");
        copy_assets(&src, &dest).unwrap();

        assert_eq!(fs::read(dest.join("a.jpg")).unwrap(), vec![1u8, 2, 3]);
        assert_eq!(fs::read(dest.join("sub/b.mp3")).unwrap(), vec![4u8, 5]);
    }

    #[test]
    fn copy_assets_takes_all_but_kin_and_manifest() {
        let src = tmp();
        fs::write(src.join("main.kin"), "开场").unwrap();
        fs::write(src.join("故事.kiw"), "{}").unwrap();
        fs::write(src.join("kiny.json"), "{}").unwrap();
        fs::write(src.join("skin.css"), ".player{}").unwrap();
        fs::create_dir_all(src.join("fonts")).unwrap();
        fs::write(src.join("fonts/楷体.woff2"), [9u8]).unwrap();

        let dest = tmp().join("out");
        copy_assets(&src, &dest).unwrap();

        assert!(dest.join("skin.css").exists(), "css 应拷贝（导出页另有内联，原文件亦保留）");
        assert!(dest.join("fonts/楷体.woff2").exists(), "字体应按相对路径拷贝");
        assert!(!dest.join("main.kin").exists(), ".kin 已内联进页面数据，不落盘");
        assert!(!dest.join("故事.kiw").exists(), "manifest 不落盘");
        assert!(!dest.join("kiny.json").exists(), "旧 manifest 不落盘");
    }

    #[test]
    fn copy_assets_skips_hidden_and_node_modules() {
        let src = tmp();
        fs::create_dir_all(src.join(".git")).unwrap();
        fs::write(src.join(".git/x.png"), [1u8]).unwrap();
        fs::create_dir_all(src.join("node_modules")).unwrap();
        fs::write(src.join("node_modules/y.css"), "a{}").unwrap();
        fs::write(src.join(".hidden.png"), [2u8]).unwrap();
        fs::write(src.join("keep.png"), [3u8]).unwrap();

        let dest = tmp().join("out");
        copy_assets(&src, &dest).unwrap();

        assert!(dest.join("keep.png").exists());
        assert!(!dest.join(".git").exists());
        assert!(!dest.join("node_modules").exists());
        assert!(!dest.join(".hidden.png").exists());
    }

    #[test]
    fn copy_assets_then_index_html_wins() {
        // 项目根自带 index.html（.html 是可编辑资源之一）时，导出的页面必须最终胜出。
        let src = tmp();
        fs::write(src.join("index.html"), "作者的页面").unwrap();
        let dest = tmp().join("out");
        fs::create_dir_all(&dest).unwrap();

        copy_assets(&src, &dest).unwrap();
        fs::write(dest.join("index.html"), "导出的页面").unwrap();

        assert_eq!(fs::read_to_string(dest.join("index.html")).unwrap(), "导出的页面");
    }

    #[test]
    fn copy_assets_makes_no_empty_dirs() {
        let src = tmp();
        fs::create_dir_all(src.join("only-kin")).unwrap();
        fs::write(src.join("only-kin/a.kin"), "x").unwrap();

        let dest = tmp().join("out");
        copy_assets(&src, &dest).unwrap();

        assert!(!dest.join("only-kin").exists(), "只含 .kin 的目录不产出空目录");
    }
}
