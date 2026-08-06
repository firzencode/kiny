import { describe, it, expect } from 'vitest'
import { advance, choose, initialState } from '@kiny/player'
import { assembleFromFiles } from '@kiny/engine'
import { captureSave, restoreSave, previewLabel } from './snapshot'
import { AUTO_SAVE_ID } from './types'

const MANIFEST = JSON.stringify({ name: 'T', version: '1', engine: '0.1.0', entry: 'main.kin' })
const KIN = `开场文本。
* [向左] -> 左
* [向右] -> 右
=== 左 ===
你往左走，触发结局。
-> END
=== 右 ===
你往右走。
-> END
`
const resolve = (n: string) => n

function assemble(kin = KIN) {
  const r = assembleFromFiles(MANIFEST, new Map([['main.kin', kin]]), { seed: 42 })
  if (!r.ok) throw new Error(r.message)
  return r
}

describe('previewLabel', () => {
  it('取末条叙事纯文本片段', () => {
    const r = assemble()
    const play = advance(r.story, initialState, resolve).state
    expect(previewLabel(play)).toContain('开场文本')
  })
  it('已结束 →「（已结束）」', () => {
    const r = assemble()
    let play = advance(r.story, initialState, resolve).state
    play = choose(r.story, play, play.choices[0].index, resolve).state // 向左 → END
    expect(play.ended).toBe(true)
    expect(previewLabel(play)).toBe('（已结束）')
  })
})

describe('captureSave / restoreSave 往返', () => {
  it('在选项点捕获 → 恢复 → 继续与不中断等价', () => {
    const direct = assemble()
    const directFirst = advance(direct.story, initialState, resolve).state
    const idx = directFirst.choices[0].index
    const directAfter = choose(direct.story, directFirst, idx, resolve).state

    const src = assemble()
    const first = advance(src.story, initialState, resolve).state
    const save = captureSave(src.story, first, 'auto', AUTO_SAVE_ID, 1000, 'book')

    const fresh = assemble()
    const restored = restoreSave(fresh.program, save)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.play).toEqual(first)
    const restoredAfter = choose(restored.story, restored.play, idx, resolve).state
    expect(restoredAfter.log).toEqual(directAfter.log)
    expect(restoredAfter.ended).toBe(directAfter.ended)
  })

  it('捕获写入 snapshot + play + meta（label/timestamp）', () => {
    const r = assemble()
    const play = advance(r.story, initialState, resolve).state
    const save = captureSave(r.story, play, 'manual', 'deadbeef', 1234, 'book')
    expect(save.kind).toBe('manual')
    expect(save.id).toBe('deadbeef')
    expect(save.storyId).toBe('book') // 复合主键的第一段，须落在记录里
    expect(save.meta.timestamp).toBe(1234)
    expect(save.meta.label).toContain('开场文本')
    expect(save.play).toEqual(play)
    expect(save.snapshot.fingerprint).toBeTruthy()
  })
})

describe('restoreSave 降级', () => {
  it('故事改过（fingerprint 失配）→ 不载入、报 fingerprint-mismatch', () => {
    const r = assemble()
    const play = advance(r.story, initialState, resolve).state
    const save = captureSave(r.story, play, 'auto', AUTO_SAVE_ID, 0, 'book')
    const changed = assemble(KIN + '\n=== 新增 ===\n额外。\n-> END\n')
    const res = restoreSave(changed.program, save)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('fingerprint-mismatch')
  })
})
