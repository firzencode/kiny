import { assembleFromFiles } from '@kiny/engine'
import { unzipKip, type UnzippedKip } from '../kip/unzipKip'
import { readDisplayMeta } from '../kip/displayMeta'
import { openDb, txDone, reqDone, STORE_STORIES, STORE_PACKAGES } from './db'
import type { LibraryItem, StoredStory, StoredPackage } from './types'

/**
 * 导入一个 `.kip`：解压 → 装配校验（坏包即抛、不落库）→ 分配 id → 元信息 + 包体分别落两 store（同一事务，原子）。
 * 重复导入同一 `.kip` 默认新增一本（各自新 id），不去重。
 */
export async function importKip(bytes: Uint8Array): Promise<LibraryItem> {
  const kip = unzipKip(bytes) // 坏 zip / 缺 manifest 抛错
  const res = assembleFromFiles(kip.manifestText, kip.kinFiles, { manifestName: kip.manifestName })
  if (!res.ok) throw new Error(res.message) // 坏包拒收
  const disp = readDisplayMeta(kip.manifestText)
  const id = crypto.randomUUID()
  const coverBlob = disp.cover ? kip.assets.get(disp.cover) : undefined
  const story: StoredStory = {
    id, name: res.meta.name, author: disp.author, description: disp.description,
    version: res.meta.version, importedAt: Date.now(), coverBlob,
  }
  const pkg: StoredPackage = {
    id, manifestName: kip.manifestName, manifestText: kip.manifestText,
    kinFiles: Object.fromEntries(kip.kinFiles), assets: Object.fromEntries(kip.assets),
  }
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_STORIES, STORE_PACKAGES], 'readwrite')
    tx.objectStore(STORE_STORIES).put(story)
    tx.objectStore(STORE_PACKAGES).put(pkg)
    await txDone(tx)
  } finally {
    db.close()
  }
  return { id, name: story.name, author: story.author, description: story.description, version: story.version }
}

/** 列出书架（只读 stories）：按导入时间倒序；有封面则建 objectURL（调用方负责回收）。 */
export async function listLibrary(): Promise<LibraryItem[]> {
  const db = await openDb()
  let stories: StoredStory[]
  try {
    const tx = db.transaction(STORE_STORIES, 'readonly')
    stories = await reqDone(tx.objectStore(STORE_STORIES).getAll() as IDBRequest<StoredStory[]>)
  } finally {
    db.close()
  }
  return stories
    .sort((a, b) => b.importedAt - a.importedAt)
    .map((s) => ({
      id: s.id, name: s.name, author: s.author, description: s.description, version: s.version,
      coverUrl: s.coverBlob ? URL.createObjectURL(s.coverBlob) : undefined,
    }))
}

/** 取回一本书的包体（打开阅读用），Record 还原为 Map 供 loadFromLibrary 消费。不存在 → 抛错。 */
export async function openPackage(id: string): Promise<UnzippedKip> {
  const db = await openDb()
  let pkg: StoredPackage | undefined
  try {
    const tx = db.transaction(STORE_PACKAGES, 'readonly')
    pkg = await reqDone(tx.objectStore(STORE_PACKAGES).get(id) as IDBRequest<StoredPackage | undefined>)
  } finally {
    db.close()
  }
  if (!pkg) throw new Error('故事包不存在')
  return {
    manifestName: pkg.manifestName,
    manifestText: pkg.manifestText,
    kinFiles: new Map(Object.entries(pkg.kinFiles)),
    assets: new Map(Object.entries(pkg.assets)),
  }
}

/** 删除一本书（元信息 + 包体，同一事务）。 */
export async function deleteStory(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_STORIES, STORE_PACKAGES], 'readwrite')
    tx.objectStore(STORE_STORIES).delete(id)
    tx.objectStore(STORE_PACKAGES).delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}
