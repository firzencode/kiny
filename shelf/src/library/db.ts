const DB_NAME = 'kiny-shelf'
/** 2：增建 `saves` store（存档由 localStorage 迁入，见 saves/store.ts 与 saves/migrate.ts）。 */
const DB_VERSION = 2
export const STORE_STORIES = 'stories'
export const STORE_PACKAGES = 'packages'
export const STORE_SAVES = 'saves'

/**
 * 打开（首次建三 store）。升级逻辑一律 `if (!contains) create`——**幂等**，故不论从空库、
 * v1 老库还是 v2 直建，都能一次到位，且既有 store 的数据原样保留。
 * `saves` 用复合主键 `['storyId','id']`：一本书的存档天然聚在键空间的一段里，
 * 「列举一本书的档」与「删书清档」都用同一个范围查询搞定，不需要额外索引。
 * IndexedDB 不可用（隐私模式等）→ reject，交调用方明确报错（或由 probeIndexedDB 转降级）。
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持 IndexedDB，无法保存书库')); return }
    // blocked 只是「暂时被挡住」，请求并未取消：对方标签页一关，onsuccess 照样触发。
    // 那时 promise 已 settle，拿到的连接没有任何人持有、也就永远不会 close——它自己
    // 就会挡住下一次版本升级，正是这里要防的那件事。故记下已 settle 并把它关掉。
    let settled = false
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_STORIES)) db.createObjectStore(STORE_STORIES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_PACKAGES)) db.createObjectStore(STORE_PACKAGES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_SAVES)) db.createObjectStore(STORE_SAVES, { keyPath: ['storyId', 'id'] })
    }
    req.onsuccess = () => {
      if (settled) { req.result.close(); return } // 已按 blocked 落定：这个迟到的连接没人要，关掉
      settled = true
      resolve(req.result)
    }
    req.onerror = () => { settled = true; reject(req.error ?? new Error('打开数据库失败')) }
    // 版本升级被别的标签页的旧连接挡住时，open 既不 success 也不 error——不接这个回调，
    // promise 就永不落定，App 会永远停在「正在打开书库…」。转成可读的错误。
    req.onblocked = () => {
      settled = true
      reject(new Error('书库正在别的标签页里升级，请关掉其它标签页后重试'))
    }
  })
}

/** 一本书全部存档的主键范围：`['storyId', …]` 的整段（`[]` 大于任何字符串，故作上界哨兵）。 */
export function savesRange(storyId: string): IDBKeyRange {
  return IDBKeyRange.bound([storyId], [storyId, []])
}

/**
 * 探测 IndexedDB 是否可用：打得开即关掉并返回 true，任何失败（未定义、隐私模式 open 抛错 /
 * 被拒、升级失败）返回 false。**不 reject**——IndexedDB 不可用不是错误，是一种正常降级形态，
 * 由调用方切到「单次导入即读」的临时模式。
 */
export async function probeIndexedDB(): Promise<boolean> {
  try {
    const db = await openDb()
    db.close()
    return true
  } catch {
    return false
  }
}

/** 等一个事务完成（写操作用）。 */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('数据库事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('数据库事务中止'))
  })
}

/** 把一个 IDBRequest 转 Promise（读操作用）。 */
export function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('数据库请求失败'))
  })
}
