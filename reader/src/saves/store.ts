import { invoke } from '@tauri-apps/api/core'
import type { SaveRecord } from './types'

/** 列出某书的全部存档（自动 + 手动）。 */
export async function listSaves(storyId: string): Promise<SaveRecord[]> {
  return invoke<SaveRecord[]>('list_saves', { storyId })
}

/** 写入 / 覆盖一条存档（按 save.id 为文件名）。 */
export async function writeSave(storyId: string, save: SaveRecord): Promise<void> {
  await invoke('write_save', { storyId, save })
}

// per-story 串行化写队列（B8）：Tauri 命令在线程池并发执行，快速连点选项时两次对同一
// auto.json 的写入完成顺序无保证——旧态可能后落盘覆盖新态。把同一 story 的写链式追加，
// 保证按发起顺序落盘。链不因单次失败断裂（catch 后继续接下一个）。
const writeChains = new Map<string, Promise<unknown>>()
export function writeSaveSerial(storyId: string, save: SaveRecord): Promise<void> {
  const prev = writeChains.get(storyId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(() => writeSave(storyId, save))
  writeChains.set(storyId, next.catch(() => {}))
  return next
}

/** 读一条存档；不存在返回 null。 */
export async function readSave(storyId: string, saveId: string): Promise<SaveRecord | null> {
  return (await invoke<SaveRecord | null>('read_save', { storyId, saveId })) ?? null
}

/** 一次返回有 auto 续读存档的 storyId 集合（书架「继续」入口探测，替代逐本 readSave 的 N+1 IPC）。 */
export async function storiesWithAutoSave(): Promise<string[]> {
  return invoke<string[]>('stories_with_auto_save')
}

/** 删一条存档。 */
export async function deleteSave(storyId: string, saveId: string): Promise<void> {
  await invoke('delete_save', { storyId, saveId })
}

/** 生成手动存档 id（32 位十六进制，与 Rust is_valid_save_id 的 hex 规则一致）。 */
export function genSaveId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
