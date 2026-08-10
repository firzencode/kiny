import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeEditor } from './ThemeEditor'
import { THEME_PRESETS } from '../theme/presets'
import { THEME_FIELDS } from '../theme/fields'

const THEME = `/* 我的主题 */
.player {
  --kiny-page-bg: #0d1117;   /* 页面底色 */
  --kiny-text: #e8e8e8;
  --kiny-prose-font: system-ui, sans-serif;
  --kiny-prose-size: 1.05rem;
  --kiny-prose-line-height: 1.9;
  --kiny-content-max-width: 680px;
}
`

function setup(source = THEME, fonts: string[] = [], readOnly = false) {
  const onChange = vi.fn()
  render(<ThemeEditor source={source} onChange={onChange} fonts={fonts} readOnly={readOnly}
    rawEditor={<div>原文编辑器</div>} />)
  return { onChange }
}

describe('ThemeEditor 双模', () => {
  it('默认停在「外观」页，原文页不呈现（不懂 css 的作者不被代码吓到）', () => {
    setup()
    expect(screen.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('原文编辑器')).not.toBeInTheDocument()
  })

  it('切到「原文」→ 呈现传入的文本编辑器，外观表单收起', async () => {
    setup()
    await userEvent.click(screen.getByRole('tab', { name: '原文' }))
    expect(screen.getByText('原文编辑器')).toBeInTheDocument()
    expect(screen.queryByLabelText('页面底色')).not.toBeInTheDocument()
  })

  it('外观页按文件当前值回填各控件', () => {
    setup()
    expect(screen.getByLabelText('页面底色')).toHaveValue('#0d1117')
    expect(screen.getByLabelText('正文文字色')).toHaveValue('#e8e8e8')
    expect(screen.getByLabelText('正文字号')).toHaveValue('1.05')
    expect(screen.getByLabelText('行高')).toHaveValue('1.9')
    expect(screen.getByLabelText('阅读栏宽')).toHaveValue('680')
  })
})

describe('ThemeEditor 写回（定点替换）', () => {
  it('改颜色 → 只替换该 token 的值，注释与其它行逐字保留', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText('页面底色'), { target: { value: '#ffffff' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as string
    expect(next).toBe(THEME.replace('#0d1117', '#ffffff'))
  })

  it('拖字号滑杆 → 写回带单位的值', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText('正文字号'), { target: { value: '1.3' } })
    expect(onChange.mock.calls[0][0]).toContain('--kiny-prose-size: 1.3rem;')
  })

  it('栏宽写回带 px', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText('阅读栏宽'), { target: { value: '720' } })
    expect(onChange.mock.calls[0][0]).toContain('--kiny-content-max-width: 720px;')
  })

  it('行高是纯数字，写回不带单位', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText('行高'), { target: { value: '2.1' } })
    expect(onChange.mock.calls[0][0]).toContain('--kiny-prose-line-height: 2.1;')
  })

  it('文件里缺的 token 也能设：追加进 .player 块，原内容逐字保留', () => {
    const bare = '/* 空 */\n.player {\n  --kiny-text: #fff;\n}\n'
    const { onChange } = setup(bare)
    fireEvent.change(screen.getByLabelText('页面底色'), { target: { value: '#101010' } })
    const next = onChange.mock.calls[0][0] as string
    expect(next).toContain('--kiny-page-bg: #101010;')
    expect(next).toContain('/* 空 */')
    expect(next).toContain('--kiny-text: #fff;')
  })
})

describe('ThemeEditor 字体下拉', () => {
  it('列出项目内字体（放进字体文件即可选），并含通用族', async () => {
    setup(THEME, ['楷体', '思源宋体'])
    const select = screen.getByLabelText('正文字体')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['楷体', '思源宋体', '系统默认']),
    )
  })

  it('选一个项目字体 → 写回加引号的族名 + 回退族', async () => {
    const { onChange } = setup(THEME, ['楷体'])
    await userEvent.selectOptions(screen.getByLabelText('正文字体'), screen.getByRole('option', { name: '楷体' }))
    expect(onChange.mock.calls[0][0]).toContain('--kiny-prose-font: "楷体", serif;')
  })

  it('文件里的字体值不在下拉里 → 作为当前项列出，不被静默改掉', () => {
    setup('.player { --kiny-prose-font: "祖传字体", serif; }\n', ['楷体'])
    const select = screen.getByLabelText('正文字体') as HTMLSelectElement
    expect(select.value).toBe('"祖传字体", serif')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toContain('"祖传字体", serif（文件中）')
  })
})

describe('ThemeEditor 表达力落差', () => {
  const css = `.player {
  --kiny-text: #111;
  --kiny-txet: #f00;
  letter-spacing: .05em;
}
.player .panel-bottom { background: #000; }
`

  it('作者自己写的东西给出计数并引导至原文，不静默隐藏', () => {
    setup(css)
    // letter-spacing + .player .panel-bottom = 2 处
    expect(screen.getByText(/还有 2 处自定义样式/)).toBeInTheDocument()
  })

  it('表外的 --kiny- 变量单独点出来（可能是自定义的，也可能是拼错的——不替作者下结论）', () => {
    setup(css)
    expect(screen.getByText(/有 1 个/)).toHaveTextContent('变量不在本页的表里')
  })

  it('没有未覆盖内容时两条提示都不显示', () => {
    setup()
    expect(screen.queryByText(/还有 .* 处自定义样式/)).not.toBeInTheDocument()
    expect(screen.queryByText(/不在本页的表里/)).not.toBeInTheDocument()
  })

  it('值不是 GUI 能表达的形态（如 clamp）→ 该项退化为文本输入，照样可改', () => {
    const css = '.player {\n  --kiny-prose-size: clamp(1rem, 2vw, 1.4rem);\n}\n'
    const { onChange } = setup(css)
    const input = screen.getByLabelText('正文字号')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('clamp(1rem, 2vw, 1.4rem)')
    fireEvent.change(input, { target: { value: '1.2rem' } })
    fireEvent.blur(input)
    expect(onChange.mock.calls[0][0]).toContain('--kiny-prose-size: 1.2rem;')
  })
})

describe('ThemeEditor 进阶分组（默认 css 里能调的，GUI 里都能调）', () => {
  const openAdvanced = () => userEvent.click(screen.getByRole('button', { name: /进阶/ }))

  it('默认收起：不懂 css 的作者一眼只看见常用的六项', () => {
    setup()
    expect(screen.getByRole('button', { name: /进阶/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('按钮描边')).not.toBeInTheDocument()
  })

  it('展开后，player 契约里的每个 token 都有控件', async () => {
    setup()
    await openAdvanced()
    for (const f of THEME_FIELDS) {
      expect(screen.getByLabelText(f.label), f.name).toBeInTheDocument()
    }
  })

  it('半透明 token：透明度滑杆写回新的 alpha，色相不动', async () => {
    const { onChange } = setup()
    await openAdvanced()
    const alphaSlider = screen.getByLabelText('按钮描边不透明度')
    expect(alphaSlider).toHaveValue('0.35') // player 默认 rgba(255,255,255,.35)
    fireEvent.change(alphaSlider, { target: { value: '0.6' } })
    expect(onChange.mock.calls[0][0]).toContain('--kiny-control-border: rgba(255, 255, 255, .6);')
  })

  it('全透明字段（面板底色默认 transparent）上取色 → 取到的颜色真的落下去，不被 transparent 吞掉', async () => {
    const { onChange } = setup()
    await openAdvanced()
    expect(screen.getByLabelText('面板底色不透明度')).toHaveValue('0') // 默认 transparent
    fireEvent.change(screen.getByLabelText('面板底色'), { target: { value: '#223344' } })
    const next = onChange.mock.calls[0][0] as string
    expect(next).toContain('--kiny-panel-bg: #223344;')
    expect(next).not.toContain('--kiny-panel-bg: transparent;')
  })

  it('改半透明色的色相：保住原透明度，不把它悄悄改成不透明', async () => {
    const { onChange } = setup()
    await openAdvanced()
    fireEvent.change(screen.getByLabelText('按钮描边'), { target: { value: '#204060' } })
    expect(onChange.mock.calls[0][0]).toContain('--kiny-control-border: rgba(32, 64, 96, .35);')
  })

  it('不透明 token 不给透明度滑杆（免得平添噪音）', async () => {
    setup()
    await openAdvanced()
    expect(screen.queryByLabelText('按钮文字色不透明度')).not.toBeInTheDocument()
  })

  it('面板类未在文件里声明时，控件显示由正文色推导出的实际颜色', async () => {
    setup('.player {\n  --kiny-text: #2f2822;\n}\n')
    await openAdvanced()
    // player 里是 color-mix(… var(--kiny-text) 62%, transparent)
    expect(screen.getByLabelText('面板文字色不透明度')).toHaveValue('0.62')
    expect(screen.getByLabelText('面板文字色')).toHaveValue('#2f2822')
  })

  it('只看不动 → 不写回，正文色与面板色的联动不被无声切断', async () => {
    const { onChange } = setup('.player {\n  --kiny-text: #2f2822;\n}\n')
    await openAdvanced()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('ThemeEditor 降级文本输入：打字不写盘、失焦才提交', () => {
  const clampCss = '.player {\n  --kiny-prose-size: clamp(1rem, 2vw, 1.4rem);\n}\n'
  const rgbaCss = '.player {\n  --kiny-page-bg: rgba(0, 0, 0, .5);\n}\n'

  it('打字过程中不写回文件（否则每敲一个字都在改作者的文件）', () => {
    const { onChange } = setup(clampCss)
    const input = screen.getByLabelText('正文字号')
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '1.' } })
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('1.5') // 草稿留在控件里，照常看得见
  })

  it('打到一半控件不会被换掉：`1.5` 已落进滑杆量程，但仍是文本框，`1.55` 打得出来', () => {
    const { onChange } = setup(clampCss)
    const input = screen.getByLabelText('正文字号')
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(screen.getByLabelText('正文字号')).toHaveAttribute('type', 'text') // 没变成滑杆
    fireEvent.change(input, { target: { value: '1.55rem' } })
    fireEvent.blur(input)
    expect(onChange.mock.calls[0][0]).toContain('--kiny-prose-size: 1.55rem;')
  })

  it('颜色同理：`#0d1` 是合法三位色，但打字期间不翻成取色器，六位色打得进去', () => {
    const { onChange } = setup(rgbaCss)
    const input = screen.getByLabelText('页面底色')
    fireEvent.change(input, { target: { value: '#0d1' } })
    expect(screen.getByLabelText('页面底色')).toHaveAttribute('type', 'text')
    fireEvent.change(input, { target: { value: '#0d1117' } })
    fireEvent.blur(input)
    expect(onChange.mock.calls[0][0]).toContain('--kiny-page-bg: #0d1117;')
  })

  it('打一个引号不再让整页塌成「看不懂」——文件根本没被改', () => {
    const { onChange } = setup(clampCss)
    fireEvent.change(screen.getByLabelText('正文字号'), { target: { value: '"' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('页面底色')).toBeInTheDocument() // 表单还在
  })

  it('回车提交，Esc 放弃', () => {
    const { onChange } = setup(clampCss)
    const input = screen.getByLabelText('正文字号')
    fireEvent.change(input, { target: { value: '1.2rem' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('clamp(1rem, 2vw, 1.4rem)') // 回到文件里的值
  })

  it('值没变就不提交（免得白留一次「未保存」）', () => {
    const { onChange } = setup(clampCss)
    const input = screen.getByLabelText('正文字号')
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('ThemeEditor 预置主题', () => {
  it('列出内置的几套，各带名字与说明', () => {
    setup()
    for (const p of THEME_PRESETS) {
      expect(screen.getByRole('button', { name: new RegExp(p.name) })).toBeInTheDocument()
    }
  })

  it('点一套 → 批量定点替换写回，作者注释逐字保留', () => {
    const authored = '/* 别动我 */\n.player {\n  --kiny-page-bg: #0d1117;\n}\n'
    const { onChange } = setup(authored)
    const warm = THEME_PRESETS.find((p) => p.name === '暖纸')!
    fireEvent.click(screen.getByRole('button', { name: new RegExp(warm.name) }))
    const next = onChange.mock.calls[0][0] as string
    expect(next).toContain('/* 别动我 */')
    expect(next).toContain(`--kiny-page-bg: ${warm.tokens['--kiny-page-bg']};`)
    expect(next).toContain(`--kiny-prose-font: ${warm.tokens['--kiny-prose-font']};`)
  })

  it('套用后 GUI 控件立刻回填成该套的值（同一份缓冲，不另存状态）', () => {
    const authored = '.player {\n  --kiny-page-bg: #0d1117;\n}\n'
    const { onChange } = setup(authored)
    const white = THEME_PRESETS.find((p) => p.name === '素白')!
    fireEvent.click(screen.getByRole('button', { name: new RegExp(white.name) }))
    const next = onChange.mock.calls[0][0] as string
    // 组件是受控的：把新文本喂回去应当看到控件跟着变
    cleanup()
    render(<ThemeEditor source={next} onChange={vi.fn()} fonts={[]} rawEditor={<div />} />)
    expect(screen.getByLabelText('页面底色')).toHaveValue(white.tokens['--kiny-page-bg'])
  })

  it('只读时不能套用（AI 正在改这个文件）', () => {
    setup(THEME, [], true)
    expect(screen.getByRole('button', { name: new RegExp(THEME_PRESETS[0].name) })).toBeDisabled()
  })

  it('文件解析不了时不出预置条（连改都不敢改，更不该整套写）', () => {
    setup('.player {\n  --kiny-text: #111;\n')
    expect(screen.queryByRole('button', { name: new RegExp(THEME_PRESETS[0].name) })).not.toBeInTheDocument()
  })
})

describe('ThemeEditor 只读（AI 运行期）', () => {
  it('控件禁用：AI 正在整篇改写这个文件，GUI 的整文件写回会把它的改动顶掉', () => {
    setup(THEME, [], true)
    expect(screen.getByLabelText('页面底色')).toBeDisabled()
    expect(screen.getByLabelText('正文字体')).toBeDisabled()
    expect(screen.getByLabelText('正文字号')).toBeDisabled()
  })

  it('不只读时控件可用', () => {
    setup()
    expect(screen.getByLabelText('页面底色')).not.toBeDisabled()
  })
})

describe('ThemeEditor 别处的换肤变量', () => {
  it('变量写在别的选择器里 → 明示可能盖过本页的改动', () => {
    setup('html .player {\n  --kiny-text: #aaa;\n}\n.player {\n  --kiny-text: #bbb;\n}\n')
    expect(screen.getByText(/1 个换肤变量写在别的选择器里/)).toBeInTheDocument()
  })

  it('没有别处变量时不出这条提示', () => {
    setup()
    expect(screen.queryByText(/写在别的选择器里/)).not.toBeInTheDocument()
  })
})

describe('ThemeEditor 解析失败', () => {
  const broken = '.player {\n  --kiny-text: #111;\n' // 花括号没闭合

  it('解析不了 → 放弃 GUI 编辑并提示切原文，绝不猜着写回', () => {
    setup(broken)
    expect(screen.getByRole('alert')).toHaveTextContent(/看不懂|无法解析/)
    expect(screen.queryByLabelText('页面底色')).not.toBeInTheDocument()
  })

  it('解析失败时「原文」页照常可用（作者得有路可走）', async () => {
    setup(broken)
    await userEvent.click(screen.getByRole('tab', { name: '原文' }))
    expect(screen.getByText('原文编辑器')).toBeInTheDocument()
  })
})
