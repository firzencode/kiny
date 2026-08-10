/** 书架列表项（UI 用）。coverUrl 为封面 objectURL（listLibrary 建，App 负责回收）。 */
export interface LibraryItem {
  id: string
  name: string
  author?: string
  description?: string
  version: string
  coverUrl?: string
}

/** IndexedDB `stories` store 的记录：元信息 + 封面（列表读取只碰这份，不必载整包资源）。 */
export interface StoredStory {
  id: string
  name: string
  author?: string
  description?: string
  version: string
  importedAt: number
  /**
   * 封面**缩略图**（导入时经 `makeCoverThumb` 压制；压不动的环境退回原图）。
   * 整表随每次打开书架读出，故按尺寸与体积双预算限制；原图不在此处丢失——它随整包
   * 存在 `packages` store 的 assets 里，阅读时照常取用。
   */
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
