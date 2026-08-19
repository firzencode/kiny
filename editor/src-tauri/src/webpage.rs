use std::fs;
use std::path::Path;
use tauri::{path::BaseDirectory, Manager};

/// 把内联数据注入模板：替换占位字符串 `"__KINY_PROJECT_DATA__"`（含引号）为实际 JSON 文本。
/// project_data 由前端 `buildProjectData` 产出，已是合法 JSON 对象文本，直接整体替换。
fn inject_project_data(template: &str, project_data: &str) -> String {
    template.replace("\"__KINY_PROJECT_DATA__\"", project_data)
}

/// 导出目录的标记文件名：`export_webpage` 建目录时写下，`copy_assets` 与 .kip 打包（kip.rs）
/// 见到就整棵跳过该目录。导出目录常就落在项目文件夹内（作者顺手选了项目目录），不认出它就会
/// 递归拷贝自己、目录无限加深；靠标记而非目录名判定，用户重命名导出目录后依然认得出。
/// `.` 开头，故本身也落在两处「跳过隐藏项」规则内，不会进导出物或 .kip。
pub(crate) const EXPORT_MARKER: &str = ".kiny-export";

/// 该目录是否是「导出独立网页」的产物目录（带标记文件）。
pub(crate) fn is_export_dir(dir: &Path) -> bool {
    dir.join(EXPORT_MARKER).is_file()
}

/// 建导出目录并打上标记。必须**先于** `copy_assets` 调用：标记就位后，遍历项目根遇到这个
/// 目录才认得出、跳得过——顺序颠倒就又变回自嵌套。
pub(crate) fn prepare_export_dir(dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    fs::write(dest.join(EXPORT_MARKER), b"").map_err(|e| e.to_string())?;
    Ok(())
}

/// 该文件是否需要拷进导出目录：项目内**全部非 `.kin`、非 manifest** 的文件（css / 字体 / 图片 /
/// 音频 / 任意旁挂资源），保持相对路径。`.kin` 源已内联进 index.html 的项目数据，manifest 同理。
fn should_copy(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !lower.ends_with(".kin") && !lower.ends_with(".kiw") && lower != "kiny.json"
}

/// 递归拷贝项目资源 src → dest：跳过 `.` 开头的项与 node_modules（镜像 .kip 打包与资源发现规则）、
/// 跳过带 `.kiny-export` 标记的导出产物目录（含 dest 自身），跳过 `.kin` / manifest。
/// 空目录不产出（只在真有文件落地时建目录）。
fn copy_assets(src: &Path, dest: &Path) -> Result<(), String> {
    for ent in fs::read_dir(src).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = ent.path();
        if path.is_dir() {
            if is_export_dir(&path) {
                continue; // 导出产物（很可能就是本次的 dest）：拷了就是自嵌套 / 套一份陈旧副本
            }
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
    // 建目录 + 打标记须先于 copy_assets：导出目标常就在项目文件夹内，标记就位后遍历才跳得过它。
    prepare_export_dir(&dest)?;

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
    fn prepare_export_dir_creates_dir_with_marker() {
        // 导出目录必须带标记：copy_assets 与 .kip 打包都靠它整棵跳过导出产物。
        let dest = tmp().join("故事-web");
        prepare_export_dir(&dest).unwrap();
        assert!(dest.is_dir());
        assert!(dest.join(EXPORT_MARKER).is_file(), "导出目录须打上标记");
        assert!(is_export_dir(&dest));
    }

    #[test]
    fn copy_assets_skips_marked_export_dir() {
        // 项目里已有的导出产物目录不作为资源拷贝——否则新导出里套一份陈旧的旧导出。
        let src = tmp();
        fs::write(src.join("a.png"), [1u8]).unwrap();
        fs::create_dir_all(src.join("故事-web")).unwrap();
        fs::write(src.join("故事-web").join(EXPORT_MARKER), "").unwrap();
        fs::write(src.join("故事-web/theme.css"), "旧").unwrap();

        let dest = tmp().join("out");
        copy_assets(&src, &dest).unwrap();

        assert!(dest.join("a.png").exists());
        assert!(!dest.join("故事-web").exists(), "带标记的导出目录应整棵跳过");
    }

    #[test]
    fn copy_assets_does_not_recurse_into_dest_inside_src() {
        // 导出目标就落在项目目录内（作者很自然会这么选）：遍历必须跳过它自己，
        // 否则边写边遍历地递归拷自己，目录无限加深直到路径超长炸掉。
        let src = tmp();
        fs::write(src.join("theme.css"), "x").unwrap();
        let dest = src.join("故事-web");
        prepare_export_dir(&dest).unwrap();

        copy_assets(&src, &dest).unwrap();

        assert!(dest.join("theme.css").is_file(), "项目资源照常拷进导出目录");
        assert!(!dest.join("故事-web").exists(), "不得把导出目录拷进它自己");
    }

    #[test]
    fn export_into_project_dir_then_kip_stays_clean() {
        // 事故复现：作者把网页导到项目文件夹内，随后打包 .kip。修复前 copy_assets 会递归拷自己，
        // 目录一层层加深（实测到 374 层、路径 1748 字符），打包再把这堆副本一并收进去，最终因
        // 路径超长中途失败——磁盘上留下一个没有 central directory 的半截 zip，reader 只能报
        // 「不是合法的 zip / .kip」。这里跑一遍完整链路，断言三处修复合起来的最终状态。
        let src = tmp();
        fs::write(
            src.join("故事.kiw"),
            r#"{"name":"故事","version":"1.0.0","engine":"0.13.0","entry":"main.kin"}"#,
        )
        .unwrap();
        fs::write(src.join("main.kin"), "=== 开场\n你好").unwrap();
        fs::write(src.join("theme.css"), ".player{}").unwrap();

        // export_webpage 的核心序列：建目录并打标记 → 拷资源 → 写 index.html。
        let web = src.join("故事-web");
        prepare_export_dir(&web).unwrap();
        copy_assets(&src, &web).unwrap();
        fs::write(web.join("index.html"), "<html>").unwrap();

        assert!(web.join("theme.css").is_file(), "资源照常拷进导出目录");
        assert!(!web.join("故事-web").exists(), "导出目录不得套进自己");

        // 再导出一次：这次 dest 已是带标记的旧产物，仍不得被当资源拷进新产物。
        copy_assets(&src, &web).unwrap();
        assert!(!web.join("故事-web").exists(), "重复导出也不得自嵌套");

        // 打包 .kip：导出产物整棵排除，包里只剩项目本体。
        let dest = tmp().join("out.kip");
        crate::kip::export_kip(
            src.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(&dest).unwrap()).unwrap();
        let mut names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec!["main.kin".to_string(), "theme.css".to_string(), "故事.kiw".to_string()],
        );
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
