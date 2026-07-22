import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyTheme, effectiveBase, effectiveVars, newCustomTheme, dedupeName,
  contrastRatio, contrastWarnings, exportTheme, parseImportedTheme,
  loadCustomThemes, saveCustomThemes, loadActiveThemeId, saveActiveThemeId,
  THEME_VARS, PRESET_VARS, PRESET_IDS, PRESET_LABEL, isPresetId,
  type CustomTheme,
} from './themes'

const theme = (over: Partial<CustomTheme> = {}): CustomTheme => ({
  id: 'c1', name: '我的', base: 'dark', overrides: {}, ...over,
})

describe('applyTheme', () => {
  let root: HTMLElement
  beforeEach(() => {
    root = document.createElement('div')
  })

  it('预设 → 设 data-theme、清所有 inline 白名单覆盖', () => {
    root.style.setProperty('--bg-0', '#111111') // 上一组残留
    applyTheme('light', [], root)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.getPropertyValue('--bg-0')).toBe('')
  })

  it('自定义 → 设 base + inline 覆盖 overrides', () => {
    const t = theme({ base: 'light', overrides: { '--accent': '#ff0000' } })
    applyTheme('c1', [t], root)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.getPropertyValue('--accent')).toBe('#ff0000')
  })

  it('切换自定义 → 预设：清掉上一组 inline 覆盖，无残留', () => {
    const t = theme({ overrides: { '--accent': '#ff0000', '--bg-0': '#222222' } })
    applyTheme('c1', [t], root)
    applyTheme('dark', [t], root)
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.getPropertyValue('--accent')).toBe('')
    expect(root.style.getPropertyValue('--bg-0')).toBe('')
  })

  it('活动 id 指向已删除自定义主题 → 回落 dark 预设、无 inline', () => {
    root.style.setProperty('--accent', '#ff0000')
    applyTheme('gone-id', [], root)
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.getPropertyValue('--accent')).toBe('')
  })

  it('overrides 里白名单外的键不写入', () => {
    const t = theme({ overrides: { '--s-node': '#abcdef', '--accent': '#ff0000' } })
    applyTheme('c1', [t], root)
    expect(root.style.getPropertyValue('--s-node')).toBe('') // 语法高亮不在白名单
    expect(root.style.getPropertyValue('--accent')).toBe('#ff0000')
  })
})

describe('素雪白（plain）第三预设（T074）', () => {
  it('注册进预设基础设施：PRESET_IDS 含 plain、isPresetId、标签、纯白 bg-0', () => {
    expect(PRESET_IDS).toContain('plain')
    expect(isPresetId('plain')).toBe(true)
    expect(PRESET_LABEL.plain).toBe('素雪白')
    expect(PRESET_VARS.plain['--bg-0']).toBe('#ffffff') // 纯白，比象牙稿 #fbfaf6 更纯
  })

  it('effectiveBase(plain) === light（素雪白明暗性质为 light，驱动 banner/swatch）', () => {
    expect(effectiveBase('plain', [])).toBe('light')
  })

  it('applyTheme(plain) → data-theme=plain、无 inline 残留', () => {
    const root = document.createElement('div')
    root.style.setProperty('--bg-0', '#000000')
    applyTheme('plain', [], root)
    expect(root.dataset.theme).toBe('plain')
    expect(root.style.getPropertyValue('--bg-0')).toBe('') // CSS 提供全部变量，无 inline
  })
})

describe('模型：effectiveBase / effectiveVars', () => {
  it('预设活动 id → 自身；自定义 → 其 base；已删除 → 回落 dark', () => {
    const t = theme({ base: 'light' })
    expect(effectiveBase('dark', [])).toBe('dark')
    expect(effectiveBase('light', [])).toBe('light')
    expect(effectiveBase('c1', [t])).toBe('light')
    expect(effectiveBase('gone', [t])).toBe('dark')
  })

  it('effectiveVars：未覆盖变量取基底值、覆盖变量取 override', () => {
    const vars = effectiveVars('dark', { '--accent': '#ff0000' })
    expect(vars['--accent']).toBe('#ff0000') // 覆盖
    expect(vars['--bg-0']).toBe(PRESET_VARS.dark['--bg-0']) // 继承基底
    expect(Object.keys(vars).length).toBe(THEME_VARS.length)
  })
})

describe('新建 / 去重', () => {
  it('newCustomTheme：overrides 空、名字含基底标签', () => {
    const t = newCustomTheme('light', [])
    expect(t.base).toBe('light')
    expect(t.overrides).toEqual({})
    expect(t.name).toContain('象牙稿')
    expect(t.id).toBeTruthy()
  })

  it('dedupeName：同名加后缀', () => {
    const existing = [theme({ name: '暗夜' }), theme({ id: 'c2', name: '暗夜 2' })]
    expect(dedupeName('暗夜', existing)).toBe('暗夜 3')
    expect(dedupeName('新的', existing)).toBe('新的')
  })
})

describe('持久化', () => {
  beforeEach(() => localStorage.clear())

  it('customThemes 存取往返；损坏/非数组返回空', () => {
    const list = [theme(), theme({ id: 'c2', name: '二' })]
    saveCustomThemes(list)
    expect(loadCustomThemes()).toEqual(list)
    localStorage.setItem('kiny-editor-custom-themes', '{bad')
    expect(loadCustomThemes()).toEqual([])
  })

  it('activeThemeId：旧 dark/light 值天然兼容为预设 id；缺省 dark', () => {
    expect(loadActiveThemeId()).toBe('dark')
    localStorage.setItem('kiny-editor-theme', 'light')
    expect(loadActiveThemeId()).toBe('light')
    expect(isPresetId('light')).toBe(true)
    saveActiveThemeId('c1')
    expect(loadActiveThemeId()).toBe('c1')
  })

  it('loadCustomThemes 过滤非法项', () => {
    localStorage.setItem('kiny-editor-custom-themes', JSON.stringify([theme(), { id: 'x', name: '无 base' }, { junk: 1 }]))
    expect(loadCustomThemes()).toEqual([theme()])
  })
})

describe('WCAG 对比度', () => {
  it('黑白最大对比 21:1；同色 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')!).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')!).toBeCloseTo(1, 5)
  })

  it('非 hex → null', () => {
    expect(contrastRatio('rgb(0,0,0)', '#fff')).toBeNull()
  })

  it('contrastWarnings：低对比对被标出、达标不标', () => {
    // --text/--bg-0 设成相近灰 → 低对比告警；其余用 dark 基底达标
    const vars = effectiveVars('dark', { '--text': '#666666', '--bg-0': '#5a5a5a' })
    const ws = contrastWarnings(vars)
    expect(ws.some((w) => w.label.includes('正文'))).toBe(true)
    // dark 基底本身正文对达标
    expect(contrastWarnings(effectiveVars('dark', {}))).toEqual([])
  })
})

describe('导入 / 导出', () => {
  it('导出不含 id，往返等价（除 id）', () => {
    const t = theme({ name: '林间', base: 'light', overrides: { '--accent': '#3355ff' } })
    const json = exportTheme(t)
    expect(JSON.parse(json).id).toBeUndefined()
    const r = parseImportedTheme(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.name).toBe('林间')
    expect(r.base).toBe('light')
    expect(r.overrides).toEqual({ '--accent': '#3355ff' })
    expect(r.skipped).toBe(0)
  })

  it('非法 base → 拒绝整份', () => {
    const r = parseImportedTheme(JSON.stringify({ name: 'x', base: 'blue', overrides: {} }))
    expect(r.ok).toBe(false)
  })

  it('越界变量键忽略、非法颜色值跳过并计数', () => {
    const r = parseImportedTheme(JSON.stringify({
      name: 'x', base: 'dark',
      overrides: { '--accent': '#123456', '--s-node': '#fff', '--bg-0': 'not-a-color', '--text': '#abc' },
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.overrides).toEqual({ '--accent': '#123456', '--text': '#abc' }) // --s-node 忽略、--bg-0 非法
    expect(r.skipped).toBe(1) // 仅白名单内非法计数（--bg-0），--s-node 不计
  })

  it('非 JSON → 可识别错误、不抛', () => {
    const r = parseImportedTheme('{not json')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('无法识别')
  })
})
