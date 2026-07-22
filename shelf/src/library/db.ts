const DB_NAME = 'kiny-shelf'
const DB_VERSION = 1
export const STORE_STORIES = 'stories'
export const STORE_PACKAGES = 'packages'

/** 打开（首次建两 store，keyPath 'id'）。IndexedDB 不可用（隐私模式等）→ reject，交调用方明确报错。 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持 IndexedDB，无法保存书库')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_STORIES)) db.createObjectStore(STORE_STORIES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_PACKAGES)) db.createObjectStore(STORE_PACKAGES, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打开数据库失败'))
  })
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
