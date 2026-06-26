import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listSaves, writeSave, readSave, deleteSave, genSaveId } from './store'
import type { SaveRecord } from './types'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

const save: SaveRecord = {
  id: 'auto', kind: 'auto',
  snapshot: { fingerprint: 'fp' } as SaveRecord['snapshot'],
  play: { log: [], host: { bg: null, bgm: null }, choices: [], ended: false, error: null },
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
})
