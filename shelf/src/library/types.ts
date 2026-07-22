/** 书架列表项（UI 用）。coverUrl 为封面 objectURL（listLibrary 建，App 负责回收）。 */
export interface LibraryItem {
  id: string
  name: string
  author?: string
  description?: string
  version: string
  coverUrl?: string
}

/** IndexedDB `stories` store 的记录：元信息 + 封面 Blob（列表读取只碰这份，不必载整包资源）。 */
export interface StoredStory {
  id: string
  name: string
  author?: string
  description?: string
  version: string
  importedAt: number
  coverBlob?: Blob
}

/** IndexedDB `packages` store 的记录：打开某本书时才读。Map 以 Record 落库（结构化克隆稳妥）。 */
export interface StoredPackage {
  id: string
  manifestName: string
  manifestText: string
  kinFiles: Record<string, string>
  assets: Record<string, Blob>
}
