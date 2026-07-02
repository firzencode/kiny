import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import type { StoryEntry, LibraryItem } from '../types'

function withCover(e: StoryEntry): LibraryItem {
  return { ...e, coverUrl: e.cover ? convertFileSrc(`${e.dir}/${e.cover}`) : undefined }
}

/** 取路径 / content:// URI 的末段作文件名（仅诊断用，content URI 取不到真名亦无妨）。 */
function basename(path: string): string {
  const seg = path.split(/[/\\]/).pop()
  return seg && seg.length > 0 ? seg : path
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const entries = await invoke<StoryEntry[]>('list_library')
  return entries.map(withCover)
}

/**
 * 导入一个 .kip。按来源分两条字节路径：
 * - **Android 的 `content://` URI**（picker 选中 / 分享·打开意图）——plugin-fs 的 readFile 在
 *   Android 读不了 content://（Tauri #9083），故交给 Rust 侧 `import_kip_uri`，经 android-fs 用
 *   ContentResolver 读字节。
 * - **桌面文件系统路径**（picker / 拖入）——前端 readFile 读成字节经原始请求体喂 `import_kip_bytes`。
 * 两条最终都汇到同一 import_from_reader 解压校验落盘。
 */
export async function importKip(path: string): Promise<LibraryItem> {
  if (path.startsWith('content://')) {
    const entry = await invoke<StoryEntry>('import_kip_uri', { uri: path })
    return withCover(entry)
  }
  const bytes = await readFile(path)
  const entry = await invoke<StoryEntry>('import_kip_bytes', bytes, {
    headers: { 'x-kip-filename': encodeURIComponent(basename(path)) },
  })
  return withCover(entry)
}

export async function deleteStory(id: string): Promise<void> {
  await invoke('delete_story', { id })
}

export async function pickKipFile(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: [{ name: 'Kiny 故事包', extensions: ['kip'] }] })
  return typeof picked === 'string' ? picked : null
}
