import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findManifest } from './locate'
import { validateManifest } from './manifest'

// 与 reader Rust（reader/src-tauri/src/kip.rs 的 manifest_cross_lang_fixture 测试）读**同一份**
// manifest-fixtures.json，两端对同批样本断言同判——防 engine 与 Rust 的 manifest 定位/校验规则漂移。
// ok 用例断言 name 一致；错误用例只断言两端都 reject（Rust 报首个缺失字段、engine 一次报全，错误消息不可逐字比）。

type LocateCase = { desc: string; names: string[]; ok: boolean; name?: string }
type ValidateCase = { desc: string; raw: unknown; ok: boolean; name?: string }
const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('./manifest-fixtures.json', import.meta.url)), 'utf8'),
) as { locate: LocateCase[]; validate: ValidateCase[] }

describe('manifest 跨语言 fixture · findManifest', () => {
  for (const c of fixtures.locate) {
    it(c.desc, () => {
      const r = findManifest(c.names)
      expect(r.ok).toBe(c.ok)
      if (c.ok && r.ok) expect(r.name).toBe(c.name)
    })
  }
})

describe('manifest 跨语言 fixture · validateManifest', () => {
  for (const c of fixtures.validate) {
    it(c.desc, () => {
      const r = validateManifest(c.raw, 'kiny.json')
      const ok = !Array.isArray(r)
      expect(ok).toBe(c.ok)
      if (c.ok && !Array.isArray(r)) expect(r.name).toBe(c.name)
    })
  }
})
