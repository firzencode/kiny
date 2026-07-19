import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emptyHost } from '@kiny/player'
import { listSaves, writeSave, writeSaveSerial, readSave, deleteSave, genSaveId } from './store'
import type { SaveRecord } from './types'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

const save: SaveRecord = {
  id: 'auto', kind: 'auto',
  snapshot: { fingerprint: 'fp' } as SaveRecord['snapshot'],
  play: { log: [], host: emptyHost, choices: [], input: null, ended: false, error: null },
  meta: { timestamp: 1, label: 'x' },
}

describe('saves store（invoke 包装）', () => {
  beforeEach(() => invoke.mockReset())

  it('listSaves 调 list_saves 带 storyId', async () => {
    invoke.mockResolvedValue([save])
    expect(await listSaves('abc')).toEqual([save])
    expect(invoke).toHaveBeenCalledWith('list_saves', { storyId: 'abc' })
  })

  it('writeSave 调 write_save 带 storyId + save', async () => {
    invoke.mockResolvedValue(undefined)
    await writeSave('abc', save)
    expect(invoke).toHaveBeenCalledWith('write_save', { storyId: 'abc', save })
  })

  it('readSave 调 read_save；null → null', async () => {
    invoke.mockResolvedValue(null)
    expect(await readSave('abc', 'auto')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('read_save', { storyId: 'abc', saveId: 'auto' })
  })

  it('deleteSave 调 delete_save', async () => {
    invoke.mockResolvedValue(undefined)
    await deleteSave('abc', 'auto')
    expect(invoke).toHaveBeenCalledWith('delete_save', { storyId: 'abc', saveId: 'auto' })
  })

  it('genSaveId 产 32 位十六进制（无横杠）', () => {
    const id = genSaveId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  // B8：同一 story 的写按发起顺序落盘，即便后发起的 IPC 先解析也不乱序。
  it('writeSaveSerial 同 story 串行化：按发起顺序落盘', async () => {
    const order: string[] = []
    // 第一个写慢、第二个写快：无串行化则 s2 先落、s1 后落（乱序）；串行化保证 s1→s2。
    invoke.mockImplementation((_cmd?: string, args?: { save?: SaveRecord }) => {
      const id = args?.save?.id
      if (!id) return Promise.resolve(undefined)
      const delay = id === 's1' ? 30 : 0
      return new Promise((res) => setTimeout(() => { order.push(id); res(undefined) }, delay))
    })
    const s1 = { ...save, id: 's1' }
    const s2 = { ...save, id: 's2' }
    const p1 = writeSaveSerial('book', s1)
    const p2 = writeSaveSerial('book', s2)
    await Promise.all([p1, p2])
    expect(order).toEqual(['s1', 's2'])
  })

  // 链不因单次失败断裂：前一个写 reject 后，后一个仍照常发起。
  it('writeSaveSerial 单次失败不断链', async () => {
    const seen: string[] = []
    invoke.mockImplementation((_cmd?: string, args?: { save?: SaveRecord }) => {
      const id = args?.save?.id
      if (!id) return Promise.resolve(undefined)
      seen.push(id)
      return id === 's1' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined)
    })
    const p1 = writeSaveSerial('book', { ...save, id: 's1' })
    await expect(p1).rejects.toThrow('boom')
    await writeSaveSerial('book', { ...save, id: 's2' })
    expect(seen).toEqual(['s1', 's2'])
  })

  // 不同 story 各自独立成链（互不阻塞）。
  it('writeSaveSerial 跨 story 独立成链', async () => {
    invoke.mockResolvedValue(undefined)
    await Promise.all([
      writeSaveSerial('a', { ...save, id: 'x' }),
      writeSaveSerial('b', { ...save, id: 'y' }),
    ])
    expect(invoke).toHaveBeenCalledWith('write_save', { storyId: 'a', save: { ...save, id: 'x' } })
    expect(invoke).toHaveBeenCalledWith('write_save', { storyId: 'b', save: { ...save, id: 'y' } })
  })
})
