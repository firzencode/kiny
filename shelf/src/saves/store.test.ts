import { describe, it, expect, beforeEach } from 'vitest'
import { emptyHost } from '@kiny/player'
import { listSaves, writeSave, readSave, deleteSave, storiesWithAutoSave, clearStorySaves, genSaveId } from './store'
import { AUTO_SAVE_ID, type SaveRecord } from './types'

function mkSave(id: string, kind: SaveRecord['kind'] = 'manual'): SaveRecord {
  return {
    id, kind,
    snapshot: { fingerprint: 'fp' } as SaveRecord['snapshot'],
    play: { log: [], host: emptyHost, choices: [], input: null, ended: false, error: null },
    meta: { timestamp: 1, label: 'x' },
  }
}

beforeEach(() => localStorage.clear())

describe('saves store（localStorage）', () => {
  it('写入 → 读回 → 列举', () => {
    writeSave('book', mkSave('a'))
    writeSave('book', mkSave('b'))
    expect(readSave('book', 'a')?.id).toBe('a')
    expect(listSaves('book').map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('readSave 不存在 → null', () => {
    expect(readSave('book', 'nope')).toBeNull()
  })

  it('listSaves 跳过损坏项、且不跨 story 串味', () => {
    writeSave('book', mkSave('a'))
    writeSave('other', mkSave('z'))
    localStorage.setItem('kiny-shelf-save:book:broken', '{不是合法JSON')
    expect(listSaves('book').map((s) => s.id)).toEqual(['a']) // 损坏跳过、other 不混入
  })

  it('deleteSave 删单条', () => {
    writeSave('book', mkSave('a'))
    writeSave('book', mkSave('b'))
    deleteSave('book', 'a')
    expect(listSaves('book').map((s) => s.id)).toEqual(['b'])
  })

  it('storiesWithAutoSave 返回有 auto 档的 storyId', () => {
    writeSave('withauto', mkSave(AUTO_SAVE_ID, 'auto'))
    writeSave('manualonly', mkSave('m1'))
    expect(storiesWithAutoSave()).toEqual(['withauto'])
  })

  it('clearStorySaves 清一书全部存档、不动别书', () => {
    writeSave('book', mkSave(AUTO_SAVE_ID, 'auto'))
    writeSave('book', mkSave('m1'))
    writeSave('keep', mkSave('k1'))
    clearStorySaves('book')
    expect(listSaves('book')).toHaveLength(0)
    expect(listSaves('keep')).toHaveLength(1)
  })

  it('genSaveId 产 32 位十六进制（无横杠）', () => {
    expect(genSaveId()).toMatch(/^[0-9a-f]{32}$/)
  })
})
