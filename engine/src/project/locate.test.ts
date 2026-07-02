import { describe, it, expect } from 'vitest'
import { findManifest } from './locate'

describe('findManifest', () => {
  it('恰好一个 .kiw → 选它', () => {
    expect(findManifest(['雾港之夜.kiw', 'main.kin'])).toEqual({ ok: true, name: '雾港之夜.kiw' })
  })

  it('零 .kiw 但有 kiny.json → fallback kiny.json（向后兼容）', () => {
    expect(findManifest(['kiny.json', 'main.kin'])).toEqual({ ok: true, name: 'kiny.json' })
  })

  it('零 .kiw 且无 kiny.json → 错误', () => {
    const r = findManifest(['main.kin', 'notes.txt'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('.kiw')
  })

  it('多个 .kiw → 错误', () => {
    const r = findManifest(['a.kiw', 'b.kiw', 'main.kin'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('多个')
  })

  it('.kiw 优先于 kiny.json（两者并存时选 .kiw）', () => {
    expect(findManifest(['雾港之夜.kiw', 'kiny.json', 'main.kin'])).toEqual({ ok: true, name: '雾港之夜.kiw' })
  })

  it('空列表 → 错误', () => {
    expect(findManifest([]).ok).toBe(false)
  })
})
