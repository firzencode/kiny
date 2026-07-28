import { describe, it, expect } from 'vitest'
import { languageFor } from './langs'

/** 语言支持是 CM6 扩展（数组 / 对象）；空数组 = 无语言（纯文本）。 */
const isEmpty = (ext: unknown) => Array.isArray(ext) && ext.length === 0

describe('languageFor', () => {
  it('.kin 与作品前端资源各有语言支持', () => {
    for (const p of ['main.kin', 'skin.css', 'a.js', 'kiny.json', 'page.html', 'notes.md']) {
      expect(isEmpty(languageFor(p)), p).toBe(false)
    }
  })

  it('纯文本 / 未知扩展名 / 无路径 → 无语言', () => {
    for (const p of ['readme.txt', 'data.bin', 'noext', null, undefined]) {
      expect(isEmpty(languageFor(p)), String(p)).toBe(true)
    }
  })

  it('扩展名大小写不敏感、按末段判定', () => {
    expect(isEmpty(languageFor('theme/SKIN.CSS'))).toBe(false)
    expect(isEmpty(languageFor('a.css/b.bin'))).toBe(true)
  })
})
