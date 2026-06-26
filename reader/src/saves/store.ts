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

/** 读一条存档；不存在返回 null。 */
export async function readSave(storyId: string, saveId: string): Promise<SaveRecord | null> {
  return (await invoke<SaveRecord | null>('read_save', { storyId, saveId })) ?? null
}

/** 删一条存档。 */
export async function deleteSave(storyId: string, saveId: string): Promise<void> {
  await invoke('delete_save', { storyId, saveId })
}

/** 生成手动存档 id（32 位十六进制，与 Rust is_valid_save_id 的 hex 规则一致）。 */
export function genSaveId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
