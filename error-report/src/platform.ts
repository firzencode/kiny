import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl, openPath } from '@tauri-apps/plugin-opener'
import { appLogDir, join } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'

/** 日志文件名（与 Rust 端 plugin-log 的 LogDir file_name 对应：kiny → kiny.log）。 */
const LOG_FILE = 'kiny.log'

/**
 * 取证用平台能力的薄封装（剪贴板 / 打开 URL / 打开日志文件夹）。
 * 全是「用户主动触发」的本地动作——不自动外传，契合不托管原则（§6）。
 * 测试通过 vi.mock('./platform') 替换。
 */

/** 复制文本到系统剪贴板。 */
export async function copyText(text: string): Promise<void> {
  await writeText(text)
}

/** 用系统默认浏览器打开外部 URL（GitHub 预填 / 反馈问卷）。 */
export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url)
}

/** 在文件管理器里打开应用日志目录（appLogDir）。 */
export async function openLogDir(): Promise<void> {
  await openPath(await appLogDir())
}

/**
 * 取文本末尾约 maxBytes 字节（按 UTF-8 计，而非 UTF-16 字符数），并对齐到行边界——
 * 丢弃开头可能被截碎的不完整一行（含跨字节切断产生的替换字符）。纯函数。
 */
export function tailByBytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  const tail = new TextDecoder().decode(bytes.slice(bytes.length - maxBytes))
  const nl = tail.indexOf('\n')
  return nl >= 0 ? tail.slice(nl + 1) : tail
}

/**
 * 读应用日志文件的近期尾部（默认末 16KB），供「非崩溃问题」的反馈也带上上下文。
 * 按 UTF-8 **字节**截断（旧实现按 UTF-16 字符数，中日文日志实际截得比 maxBytes 大得多）并对齐行边界。
 * 读不到（无文件 / 无权限 / 非 Tauri）返回 null，不抛。
 */
export async function readRecentLog(maxBytes = 16384): Promise<string | null> {
  try {
    const path = await join(await appLogDir(), LOG_FILE)
    const text = await readTextFile(path)
    return tailByBytes(text, maxBytes)
  } catch {
    return null
  }
}
