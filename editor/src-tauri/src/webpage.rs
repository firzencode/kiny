use std::fs;
use std::path::Path;
use tauri::{path::BaseDirectory, Manager};

/// 把内联数据注入模板：替换占位字符串 `"__KINY_PROJECT_DATA__"`（含引号）为实际 JSON 文本。
/// project_data 由前端 `buildProjectData` 产出，已是合法 JSON 对象文本，直接整体替换。
fn inject_project_data(template: &str, project_data: &str) -> String {
    template.replace("\"__KINY_PROJECT_DATA__\"", project_data)
}

/// 递归拷贝目录 src → dest（含子目录）。
fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for ent in fs::read_dir(src).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let path = ent.path();
        let target = dest.join(ent.file_name());
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 导出独立网页：在 parent_dir 下建 folder_name 文件夹，写入注入了 project_data 的 index.html
/// （模板取自打包进 editor 的 Tauri resource，与 web-reader 同源），并把项目 assets/ 原样拷过去。
/// 返回最终目标文件夹路径。
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
    fs::write(dest.join("index.html"), html).map_err(|e| e.to_string())?;

    // 资源走相对引用：项目 assets/（若有）整体拷到 <dest>/assets/。
    let assets_src = Path::new(&project_dir).join("assets");
    if assets_src.is_dir() {
        copy_dir(&assets_src, &dest.join("assets"))?;
    }

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
    fn copy_dir_copies_nested_files() {
        let src = tmp();
        fs::write(src.join("a.jpg"), [1u8, 2, 3]).unwrap();
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub/b.mp3"), [4u8, 5]).unwrap();

        let dest = tmp().join("out");
        copy_dir(&src, &dest).unwrap();

        assert_eq!(fs::read(dest.join("a.jpg")).unwrap(), vec![1u8, 2, 3]);
        assert_eq!(fs::read(dest.join("sub/b.mp3")).unwrap(), vec![4u8, 5]);
    }
}
