import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { StoryEntry, LibraryItem } from '../types'

function withCover(e: StoryEntry): LibraryItem {
  return { ...e, coverUrl: e.cover ? convertFileSrc(`${e.dir}/${e.cover}`) : undefined }
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const entries = await invoke<StoryEntry[]>('list_library')
  return entries.map(withCover)
}

export async function importKip(kipPath: string): Promise<LibraryItem> {
  const entry = await invoke<StoryEntry>('import_kip', { kipPath })
  return withCover(entry)
}

export async function deleteStory(id: string): Promise<void> {
  await invoke('delete_story', { id })
}

export async function pickKipFile(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: [{ name: 'Kiny 故事包', extensions: ['kip'] }] })
  return typeof picked === 'string' ? picked : null
}
