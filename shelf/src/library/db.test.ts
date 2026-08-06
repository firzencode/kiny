import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { openDb, probeIndexedDB, savesRange, STORE_SAVES, STORE_STORIES, STORE_PACKAGES } from './db'

const realIndexedDB = globalThis.indexedDB

afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: realIndexedDB, configurable: true, writable: true })
})

describe('probeIndexedDB', () => {
  it('IndexedDB 可用（fake-indexeddb 在场）→ true', async () => {
    await expect(probeIndexedDB()).resolves.toBe(true)
  })

  it('indexedDB 未定义（老浏览器）→ false，不抛', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true })
    await expect(probeIndexedDB()).resolves.toBe(false)
  })

  it('open 同步抛错（隐私模式常见形态）→ false，不抛', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { open: () => { throw new DOMException('denied', 'SecurityError') } },
      configurable: true,
      writable: true,
    })
    await expect(probeIndexedDB()).resolves.toBe(false)
  })

  it('open 请求异步 error（另一种隐私模式形态）→ false，不抛', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        open: () => {
          const req: Record<string, unknown> = { error: new Error('拒绝访问') }
          queueMicrotask(() => (req.onerror as (() => void) | undefined)?.())
          return req
        },
      },
      configurable: true,
      writable: true,
    })
    await expect(probeIndexedDB()).resolves.toBe(false)
  })
})

describe('openDb —— store 结构与升级', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('kiny-shelf')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })

  it('新库直接建出三个 store', async () => {
    const db = await openDb()
    try {
      expect([...db.objectStoreNames].sort()).toEqual([STORE_PACKAGES, STORE_SAVES, STORE_STORIES].sort())
    } finally {
      db.close()
    }
  })

  it('saves 用复合主键 ["storyId","id"]', async () => {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_SAVES, 'readonly')
      expect(tx.objectStore(STORE_SAVES).keyPath).toEqual(['storyId', 'id'])
    } finally {
      db.close()
    }
  })

  it('v1 老库升级：saves 建出来，stories / packages 的数据无损', async () => {
    // 造一个 v1 库（只有两 store）并塞进数据，模拟老用户。
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('kiny-shelf', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore(STORE_STORIES, { keyPath: 'id' })
        db.createObjectStore(STORE_PACKAGES, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction([STORE_STORIES, STORE_PACKAGES], 'readwrite')
        tx.objectStore(STORE_STORIES).put({ id: 'old', name: '老书' })
        tx.objectStore(STORE_PACKAGES).put({ id: 'old', manifestText: '{}' })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const db = await openDb() // 触发 v1 → v2 升级
    try {
      expect(db.objectStoreNames.contains(STORE_SAVES)).toBe(true)
      const tx = db.transaction(STORE_STORIES, 'readonly')
      const got = await new Promise<unknown>((res, rej) => {
        const r = tx.objectStore(STORE_STORIES).get('old')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      expect(got).toEqual({ id: 'old', name: '老书' }) // 老数据原样在
    } finally {
      db.close()
    }
  })

  it('savesRange 只圈住该 storyId 的键（前缀相近的书不被卷入）', () => {
    const r = savesRange('book')
    expect(r.includes(['book', 'a'])).toBe(true)
    expect(r.includes(['book', 'zzz'])).toBe(true)
    expect(r.includes(['book2', 'a'])).toBe(false)
    expect(r.includes(['boo', 'a'])).toBe(false)
  })
})
