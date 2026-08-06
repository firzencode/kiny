import { openDb, txDone, reqDone, savesRange, STORE_SAVES } from '../library/db'
import { serialize } from './serialQueue'
import { AUTO_SAVE_ID, type SaveRecord } from './types'

/**
 * IndexedDB 版存档 CRUD（`saves` store，复合主键 `['storyId','id']`）。
 * 与书库本体同一后端、同一配额（按磁盘可用空间计）——一条存档含完整 `PlayState`（全部叙事滚屏），
 * localStorage 的 5MB/origin 顶不住「几本长篇 × 每本几个手动档」。
 *
 * 不做 JSON 编解码：structured clone 直接存对象，省掉序列化开销与字符串膨胀。
 * `isSaveRecord` 形状校验保留——读回来的可能是旧版本写入的数据，仍需挡住形状不合者。
 */
function isSaveRecord(v: unknown): v is SaveRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.storyId === 'string' && typeof o.id === 'string' && (o.kind === 'auto' || o.kind === 'manual')
    && !!o.snapshot && !!o.play && !!o.meta
}

/** 借一次连接跑一段读写，结束即关（与 library/store.ts 同款：不持长连接，免挡后续版本升级）。 */
async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_SAVES, mode)
    const out = await fn(tx.objectStore(STORE_SAVES))
    if (mode === 'readwrite') await txDone(tx)
    return out
  } finally {
    db.close()
  }
}

/** 列出某书全部存档（形状非法者跳过）。复合主键让这本书的档天然连成一段，一次范围查询取完。 */
export async function listSaves(storyId: string): Promise<SaveRecord[]> {
  const all = await withStore('readonly', (s) => reqDone<unknown[]>(s.getAll(savesRange(storyId))))
  return all.filter(isSaveRecord)
}

/** 写 / 覆盖一条存档。配额满 / 不可用 → 抛错（调用方据实反馈，不谎报成功）。 */
export async function writeSave(storyId: string, save: SaveRecord): Promise<void> {
  // storyId 归位到记录里：调用方给的参数是真相源，防止 save.storyId 与之不一致时写进错误的键。
  await withStore('readwrite', async (s) => { s.put({ ...save, storyId }) })
}

/**
 * per-story 串行写入：同一本书的写按发起顺序落盘（时序语义与理由见 `serialQueue.ts`）。
 * 现场写存档一律走它，`writeSave` 只在迁移这类天然串行的场景里直接用。
 */
export function writeSaveSerial(storyId: string, save: SaveRecord): Promise<void> {
  return serialize(storyId, () => writeSave(storyId, save))
}

/** 读一条存档；不存在 / 形状非法 → null。 */
export async function readSave(storyId: string, saveId: string): Promise<SaveRecord | null> {
  const v = await withStore('readonly', (s) => reqDone<unknown>(s.get([storyId, saveId])))
  return isSaveRecord(v) ? v : null
}

/** 删一条存档。与 `clearStorySaves` 同理走本书的写链：否则在飞的 auto 写入落在删之后，被删的档会复活。 */
export function deleteSave(storyId: string, saveId: string): Promise<void> {
  return serialize(storyId, () => withStore('readwrite', async (s) => { s.delete([storyId, saveId]) }))
}

/**
 * 有 auto 续读档的 storyId 列表（书架「继续」入口探测）。
 *
 * **只取键、不读记录体**：复合主键 `['storyId','id']` 本身就带着全部答案，而一条记录含完整
 * `PlayState`（全部叙事滚屏）——`getAll()` 会为一个布尔问题把全库存档 structured clone 反序列化
 * 一遍，本函数在启动时与每次返回书架时都要跑。故走 `getAllKeys()`。
 *
 * 代价是失去形状校验：形状非法但 id 为 auto 的脏记录也会被算作可续读。无害——「继续」入口的
 * `readSave` 会因形状校验返回 null，从头开始播放而非报错。
 */
export async function storiesWithAutoSave(): Promise<string[]> {
  const keys = await withStore('readonly', (s) => reqDone<IDBValidKey[]>(s.getAllKeys()))
  return keys
    .filter((k): k is [string, string] => Array.isArray(k) && k[1] === AUTO_SAVE_ID)
    .map((k) => k[0])
}

/**
 * 清一书全部存档（删书时调，防孤儿存档残留）。同一范围，一次删完。
 * **与该书的写入同链**：否则删书时队列里仍可能有在飞的 auto 写入，落在删之后就留下一条
 * 既看不见（书没了）又删不掉的孤儿档——正是本函数要防的东西。
 */
export function clearStorySaves(storyId: string): Promise<void> {
  return serialize(storyId, () => withStore('readwrite', async (s) => { s.delete(savesRange(storyId)) }))
}

/** 生成手动存档 id（32 位十六进制，无横杠）。 */
export function genSaveId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
