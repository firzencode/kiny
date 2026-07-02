//! 启动期 WebView2 运行时检测（仅 Windows）。
//!
//! Tauri 应用渲染依赖系统 WebView2 运行时。NSIS 安装包会自动下载安装它，但免安装
//! portable 版没有这一步——若系统缺 WebView2，直接进窗口创建会莫名崩溃。故在建窗口前
//! 探测：缺失则弹原生中文提示引导下载、干净退出。检测对所有 Windows 构建生效（安装版
//! 因 NSIS 已装故不会触发），不为 portable 单独分叉。
//! 本模块整体仅在 Windows 编译（`lib.rs` 用 `#[cfg(windows)] mod webview2;` 引入）。

use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

// WebView2 Evergreen Runtime 在 EdgeUpdate\Clients 下的产品 GUID。
const WEBVIEW2_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 读取某注册表 hive 下子键的 `pv`（版本）字符串值；不存在 / 读失败返回 None。
fn read_pv(hive: HKEY, subkey: &str) -> Option<String> {
    let wsub = to_wide(subkey);
    let wval = to_wide("pv");
    let mut buf = [0u16; 128];
    let mut size = (buf.len() * std::mem::size_of::<u16>()) as u32;
    let rc = unsafe {
        RegGetValueW(
            hive,
            wsub.as_ptr(),
            wval.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut core::ffi::c_void,
            &mut size,
        )
    };
    if rc != 0 {
        return None; // ERROR_SUCCESS == 0
    }
    // size 含结尾 NUL（字节数）；换算成 u16 个数并去掉 NUL。
    let len = (size as usize / std::mem::size_of::<u16>()).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..len.min(buf.len())]))
}

/// 系统是否装有可用的 WebView2 运行时。查 HKLM（64 位机器在 WOW6432Node 下）与 HKCU 两处的 `pv`。
fn webview2_installed() -> bool {
    let hklm = format!(
        r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"
    );
    let hkcu = format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}");
    for (hive, sub) in [(HKEY_LOCAL_MACHINE, hklm), (HKEY_CURRENT_USER, hkcu)] {
        if let Some(pv) = read_pv(hive, &sub) {
            if !pv.is_empty() && pv != "0.0.0.0" {
                return true;
            }
        }
    }
    false
}

/// 检测 WebView2；缺失则弹原生提示框引导下载、随后干净退出（不进入会崩溃的窗口创建）。
pub fn ensure_or_exit() {
    if webview2_installed() {
        return;
    }
    let text = to_wide(
        "本应用需要 Microsoft Edge WebView2 运行时。\n\n\
         请从以下页面下载安装后再启动：\n\
         https://developer.microsoft.com/microsoft-edge/webview2/",
    );
    let caption = to_wide("缺少 WebView2 运行时");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
    std::process::exit(0);
}
