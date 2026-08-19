import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { InteractionStep } from '@kiny/player'
import {
  AUTO_SAVE_ID, savesKey, listSaves, writeSave, deleteSave, migrateLegacy, migrateByTitle, genSaveId,
  type ViewerSave,
} from './saves'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

const KEY = savesKey(undefined, '雾港之夜')
const seq: InteractionStep[] = [{ kind: 'choice', pos: 0, text: '继续' }]
/** 旧记录没有 text（该字段是后加的）：只按位置重放，isStep 须放行而非判损坏。 */
const seqNoText: InteractionStep[] = [{ kind: 'choice', pos: 0 }]

function mk(id: string, kind: ViewerSave['kind'], timestamp: number): ViewerSave {
  return { id, kind, seed: 42, seq, meta: { timestamp, label: '开场白。' } }
}

describe('viewer 存档存储层', () => {
  it('savesKey 有 id 按 id 分桶（改名不换桶），无 id 回退故事名', () => {
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    expect(savesKey(id, '雾港之夜')).toBe(savesKey(id, '灯塔'))
    expect(savesKey(id, '雾港之夜')).not.toBe(savesKey(undefined, '雾港之夜'))
    expect(savesKey(undefined, '雾港之夜')).toBe(savesKey(undefined, '雾港之夜'))
    expect(savesKey(undefined, '雾港之夜')).not.toBe(savesKey(undefined, '灯塔'))
    expect(savesKey(undefined, '雾港之夜')).not.toContain('1.0.0')
  })

  it('写 → 列出往返', () => {
    expect(writeSave(KEY, mk('a1', 'manual', 100))).toBe(true)
    expect(listSaves(KEY)).toEqual([mk('a1', 'manual', 100)])
  })

  it('同 id 覆盖而非追加（auto 档持续覆盖）', () => {
    writeSave(KEY, mk(AUTO_SAVE_ID, 'auto', 100))
    writeSave(KEY, mk(AUTO_SAVE_ID, 'auto', 200))
    const all = listSaves(KEY)
    expect(all).toHaveLength(1)
    expect(all[0]!.meta.timestamp).toBe(200)
  })

  it('多档并存，排序 auto 置顶 + 其余时间倒序', () => {
    writeSave(KEY, mk('m1', 'manual', 100))
    writeSave(KEY, mk(AUTO_SAVE_ID, 'auto', 50))
    writeSave(KEY, mk('m2', 'manual', 300))
    expect(listSaves(KEY).map((s) => s.id)).toEqual([AUTO_SAVE_ID, 'm2', 'm1'])
  })

  it('删除一条', () => {
    writeSave(KEY, mk('m1', 'manual', 100))
    writeSave(KEY, mk('m2', 'manual', 200))
    deleteSave(KEY, 'm1')
    expect(listSaves(KEY).map((s) => s.id)).toEqual(['m2'])
  })

  it('损坏数据 → 空列表（不抛）', () => {
    localStorage.setItem(KEY, '{not json')
    expect(listSaves(KEY)).toEqual([])
    localStorage.setItem(KEY, JSON.stringify({ notAnArray: true }))
    expect(listSaves(KEY)).toEqual([])
    localStorage.setItem(KEY, JSON.stringify([{ id: 'x' }])) // 形状非法
    expect(listSaves(KEY)).toEqual([])
  })

  it('数组里一条坏记录只丢那一条，不连坐整份列表', () => {
    localStorage.setItem(KEY, JSON.stringify([mk('m1', 'manual', 100), { id: 'bad' }]))
    expect(listSaves(KEY).map((s) => s.id)).toEqual(['m1'])
  })

  it('删除写盘失败（配额满 / 隐私模式）→ 返回 false，不抛', () => {
    writeSave(KEY, mk('m1', 'manual', 100))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(deleteSave(KEY, 'm1')).toBe(false)
  })

  it('写入抛错（配额满 / 隐私模式）→ 返回 false，不抛', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(writeSave(KEY, mk('m1', 'manual', 100))).toBe(false)
  })

  it('读取抛错（隐私模式）→ 空列表，不抛', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(listSaves(KEY)).toEqual([])
  })

  it('choice 步没有 text（旧记录形状）：写 → 列出往返不判损坏', () => {
    const save: ViewerSave = { id: 'a1', kind: 'manual', seed: 42, seq: seqNoText, meta: { timestamp: 100, label: '开场白。' } }
    expect(writeSave(KEY, save)).toBe(true)
    expect(listSaves(KEY)).toEqual([save])
  })

  it('迁移：当前版本的旧键转成 auto 档并删除', () => {
    localStorage.setItem('kiny-progress:雾港之夜@1.0.0', JSON.stringify({ seed: 7, seq }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    const all = listSaves(KEY)
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe(AUTO_SAVE_ID)
    expect(all[0]!.seed).toBe(7)
    expect(localStorage.getItem('kiny-progress:雾港之夜@1.0.0')).toBeNull()
  })

  it('迁移：旧记录 seq 无 text（该字段是后加的，现存读者存档的真实形状）也能正确转成 auto 档', () => {
    localStorage.setItem('kiny-progress:雾港之夜@1.0.0', JSON.stringify({ seed: 7, seq: seqNoText }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    const all = listSaves(KEY)
    expect(all).toHaveLength(1)
    expect(all[0]!.seq).toEqual(seqNoText)
  })

  it('迁移：当前版本键存在时，其余版本的旧键直接删、不转', () => {
    localStorage.setItem('kiny-progress:雾港之夜@0.9.0', JSON.stringify({ seed: 1, seq }))
    localStorage.setItem('kiny-progress:雾港之夜@1.0.0', JSON.stringify({ seed: 7, seq }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    expect(localStorage.getItem('kiny-progress:雾港之夜@0.9.0')).toBeNull()
    const all = listSaves(KEY)
    expect(all).toHaveLength(1)
    expect(all[0]!.seed).toBe(7) // 转的是当前版本那条，不是旧版本
  })

  it('迁移：没有当前版本键、旧键恰好只有一条 → 也拿它当 auto（作者升级顺手改版本号的常见路径）', () => {
    localStorage.setItem('kiny-progress:雾港之夜@0.9.0', JSON.stringify({ seed: 3, seq }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0') // 当前版本 1.0.0，但旧键是 0.9.0——键不相等
    const all = listSaves(KEY)
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe(AUTO_SAVE_ID)
    expect(all[0]!.seed).toBe(3)
    expect(localStorage.getItem('kiny-progress:雾港之夜@0.9.0')).toBeNull()
  })

  it('迁移：没有当前版本键、旧键有多条 → 无从判断哪条最新，全删不转', () => {
    localStorage.setItem('kiny-progress:雾港之夜@0.8.0', JSON.stringify({ seed: 1, seq }))
    localStorage.setItem('kiny-progress:雾港之夜@0.9.0', JSON.stringify({ seed: 2, seq }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    expect(listSaves(KEY)).toEqual([])
    expect(localStorage.getItem('kiny-progress:雾港之夜@0.8.0')).toBeNull()
    expect(localStorage.getItem('kiny-progress:雾港之夜@0.9.0')).toBeNull()
  })

  it('迁移不碰别的故事的旧键', () => {
    localStorage.setItem('kiny-progress:灯塔@1.0.0', JSON.stringify({ seed: 1, seq }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    expect(localStorage.getItem('kiny-progress:灯塔@1.0.0')).not.toBeNull()
  })

  it('迁移幂等：已有存档时重复迁移不覆盖、不重复加', () => {
    localStorage.setItem('kiny-progress:雾港之夜@1.0.0', JSON.stringify({ seed: 7, seq }))
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    migrateLegacy(KEY, '雾港之夜', '1.0.0')
    expect(listSaves(KEY)).toHaveLength(1)
  })

  it('genSaveId 是 32 位十六进制且不重复', () => {
    const a = genSaveId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(genSaveId())
  })

  it('genSaveId：crypto.randomUUID 缺失（老浏览器 / 非安全上下文）→ 回退生成，不抛、仍是 32 位十六进制', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new TypeError('randomUUID is not a function') })
    const a = genSaveId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(genSaveId()) // 回退路径生成的两个 id 也不该撞
  })
})

describe('名→id 存档迁移', () => {
  const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const idKey = savesKey(ID, '雾港之夜')
  const titleKey = savesKey(undefined, '雾港之夜')

  it('id 键为空 + 同名旧键有档 → 整份复制，旧键保留', () => {
    writeSave(titleKey, mk(AUTO_SAVE_ID, 'auto', 100))
    writeSave(titleKey, mk('m1', 'manual', 200))
    migrateByTitle(idKey, '雾港之夜')
    expect(listSaves(idKey)).toHaveLength(2)
    // 不删旧键：同名的另一份作品日后升级时同样要从这里复制，搬走即删会让先打开的一方独吞旧档
    expect(listSaves(titleKey)).toHaveLength(2)
  })

  it('读者把 id 键里的存档删光后 → 不再从旧键复制回来（幂等判「键写过没」而非「有没有档」）', () => {
    writeSave(titleKey, mk(AUTO_SAVE_ID, 'auto', 100))
    migrateByTitle(idKey, '雾港之夜')
    deleteSave(idKey, AUTO_SAVE_ID) // 面板里 auto 那条也带删除按钮
    expect(listSaves(idKey)).toEqual([])
    migrateByTitle(idKey, '雾港之夜') // 下次加载
    expect(listSaves(idKey)).toEqual([]) // 删掉的档不复活
  })

  it('id 键已有档 → 不复制（幂等）', () => {
    writeSave(titleKey, mk('m1', 'manual', 200))
    writeSave(idKey, mk(AUTO_SAVE_ID, 'auto', 300))
    migrateByTitle(idKey, '雾港之夜')
    expect(listSaves(idKey)).toEqual([mk(AUTO_SAVE_ID, 'auto', 300)])
  })

  it('旧键无档 → 什么也不做', () => {
    migrateByTitle(idKey, '雾港之夜')
    expect(listSaves(idKey)).toEqual([])
  })

  it('无 id 的老导出（键即故事名键）→ 不自我复制', () => {
    writeSave(titleKey, mk(AUTO_SAVE_ID, 'auto', 100))
    migrateByTitle(titleKey, '雾港之夜')
    expect(listSaves(titleKey)).toHaveLength(1)
  })

  it('先名→id 复制、后 migrateLegacy：复制来的存档不被更老的链覆盖', () => {
    writeSave(titleKey, mk(AUTO_SAVE_ID, 'auto', 100))
    localStorage.setItem('kiny-progress:雾港之夜@1.0.0', JSON.stringify({ seed: 7, seq }))
    migrateByTitle(idKey, '雾港之夜')
    migrateLegacy(idKey, '雾港之夜', '1.0.0')
    const auto = listSaves(idKey).find((s) => s.id === AUTO_SAVE_ID)
    expect(auto?.seed).toBe(42) // 复制来的那条（mk 的 seed），不是 legacy 的 7
  })
})
