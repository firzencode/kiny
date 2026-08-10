import { describe, it, expect } from 'vitest'
import { ACTION_MANIFEST, manifestToJsonSchema, validateCommandArgs } from './actionManifest'
import { ACTION_NAMES } from './actions'

describe('ACTION_MANIFEST', () => {
  it('覆盖 ACTION_NAMES 全集且不多不少', () => {
    const names = ACTION_MANIFEST.map((c) => c.name).sort()
    expect(names).toEqual([...ACTION_NAMES].sort())
  })
  it('命令名无重复', () => {
    const names = ACTION_MANIFEST.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
  it('manifestToJsonSchema：必填进 required、可选不进', () => {
    const gd = ACTION_MANIFEST.find((c) => c.name === 'getDiagnostics')!
    const schema = manifestToJsonSchema(gd)
    expect(schema.properties.path.type).toBe('string')
    expect('required' in schema).toBe(false) // getDiagnostics.path 可选 → 无 required
    const wf = manifestToJsonSchema(ACTION_MANIFEST.find((c) => c.name === 'writeFile')!)
    expect(wf.required).toEqual(['path', 'source'])
  })
  it('内容型参数恰为 writeFile.source / insertText.text / replaceRange.text，submitInput.text 不算', () => {
    const contentParams = ACTION_MANIFEST.flatMap((c) =>
      Object.entries(c.params).filter(([, p]) => p.content).map(([k]) => `${c.name}.${k}`),
    )
    expect(contentParams.sort()).toEqual(['insertText.text', 'replaceRange.text', 'writeFile.source'])
    const si = ACTION_MANIFEST.find((c) => c.name === 'submitInput')!
    expect(si.params.text.content).toBeUndefined()
  })
  it('路径 / 名称型参数都带 nonEmpty（空串对它们没有意义，CLI 本地拦下）', () => {
    // 反向断言：每个 string 且非 content 的参数都**必须**标 nonEmpty，除非在下面的显式豁免
    // 清单里。正向列一份参数名清单（旧写法）在新增一个叫 dir/name/file 的参数时会静默漏标、
    // 测试照样绿——必须反过来，让「漏标」本身触发红。
    const EXEMPT = new Set(['submitInput.text']) // 读者在输入框直接回车提交空文本是合法操作
    const missing: string[] = []
    for (const cmd of ACTION_MANIFEST) {
      for (const [key, p] of Object.entries(cmd.params)) {
        if (p.type !== 'string' || p.content) continue
        if (EXEMPT.has(`${cmd.name}.${key}`)) continue
        if (p.nonEmpty !== true) missing.push(`${cmd.name}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
  it('内容型与自由文本参数不带 nonEmpty', () => {
    const marked: string[] = []
    for (const cmd of ACTION_MANIFEST) {
      for (const [key, p] of Object.entries(cmd.params)) {
        if ((p.content || key === 'text') && p.nonEmpty) marked.push(`${cmd.name}.${key}`)
      }
    }
    expect(marked).toEqual([])
  })
})

describe('validateCommandArgs · 不可信输入的运行时参数校验', () => {
  it('合法命令通过（返回 null）', () => {
    expect(validateCommandArgs({ name: 'insertText', path: 'main.kin', offset: 0, text: 'x' })).toBeNull()
    expect(validateCommandArgs({ name: 'listProject' })).toBeNull()
  })
  it('缺必填参数 → 报错并点名参数（insertText 缺 offset）', () => {
    expect(validateCommandArgs({ name: 'insertText', path: 'main.kin', text: 'x' })).toMatch(/offset/)
  })
  it('可选参数缺失不报错（getDiagnostics 无 path）', () => {
    expect(validateCommandArgs({ name: 'getDiagnostics' })).toBeNull()
  })
  it('integer 参数收到字符串 / 小数 → 报错', () => {
    expect(validateCommandArgs({ name: 'choose', pos: '0' })).toMatch(/pos/)
    expect(validateCommandArgs({ name: 'choose', pos: 1.5 })).toMatch(/pos/)
  })
  it('string 参数收到非字符串 → 报错', () => {
    expect(validateCommandArgs({ name: 'readFile', path: 42 })).toMatch(/path/)
  })
  it('未知命令名 → 报错', () => {
    expect(validateCommandArgs({ name: 'noSuchCommand' })).toMatch(/未知命令/)
  })
  it('多个问题聚合成一条信息', () => {
    const msg = validateCommandArgs({ name: 'replaceRange', path: 'main.kin' })
    expect(msg).toMatch(/start/)
    expect(msg).toMatch(/end/)
    expect(msg).toMatch(/text/)
  })
})
