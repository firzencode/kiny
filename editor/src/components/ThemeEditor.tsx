import { useMemo, useState, type ReactNode } from 'react'
import { scanThemeCss, setTokenValue } from '../theme/scan'
import { THEME_PRESETS, applyPreset } from '../theme/presets'
import { DraftInput } from './DraftInput'
import {
  THEME_FIELDS, FIELD_NAMES, PRIMARY_GROUPS, defaultValueOf, GENERIC_FONTS, toHexColor, toNumber,
  type ThemeField,
} from '../theme/fields'
import { parseColor, formatColor } from '../theme/color'

interface ThemeEditorProps {
  /** 当前 `.css` 缓冲全文（唯一真相）。 */
  source: string
  /** 定点替换后的新全文。 */
  onChange: (next: string) => void
  /** 项目内已注册的字体族名（放进字体文件即可选，无需书写 @font-face）。 */
  fonts: string[]
  /**
   * 置只读（AI 运行期）：GUI 的写回是**整文件**替换，与 AI 的整篇改写互相顶掉，
   * 故此时禁用全部控件（「原文」页由 EditorPane 自己挡）。默认 false。
   */
  readOnly?: boolean
  /** 「原文」页要呈现的文本编辑器（由 App 传入，令本组件不依赖 CodeMirror、可单测）。 */
  rawEditor: ReactNode
}

/**
 * `.css` 的双模编辑器：「外观」是 GUI，「原文」是带高亮的文本编辑器——同一个文件、两个视图，
 * 文件始终是唯一真相。GUI 改动走**定点替换**（只换值区间那段字符），作者的注释与排版逐字保留。
 *
 * 不做分栏并列：编辑区左有资源管理器、右有预览，再切一刀过挤；标签切换也让不懂 css 的作者
 * 几乎永远停在「外观」页。
 */
export function ThemeEditor({ source, onChange, fonts, readOnly = false, rawEditor }: ThemeEditorProps) {
  const [tab, setTab] = useState<'gui' | 'raw'>('gui')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const scan = useMemo(() => scanThemeCss(source), [source])

  const fileValue = (name: string): string | undefined =>
    scan.ok ? scan.tokens.find((t) => t.name === name)?.value : undefined

  /**
   * 当前生效值：文件里有就用文件的，没有则用 player 默认值。面板类的默认值由**当前生效的
   * 正文色**推导（player 里就是 `color-mix(… var(--kiny-text) N%…)`），故先取正文色。
   */
  const effectiveText = fileValue('--kiny-text') ?? defaultValueOf('--kiny-text', '')
  const valueOf = (name: string): string =>
    scan.ok ? fileValue(name) ?? defaultValueOf(name, effectiveText) : ''

  /** 作者自己写的、GUI 管不到的东西（非 token 声明、别的规则块）。 */
  const uncovered = scan.ok ? scan.uncoveredCount : 0
  /**
   * 文件里出现了本编辑器不认识的 `--kiny-*`——GUI 已覆盖 player 契约里的每一个 token，
   * 故剩下的要么是作者自定义、自己在别处 `var()` 引用的变量（合法且有效），要么是拼错的
   * 名字（写了不生效）。文案两种都要容得下：**不断言**它没用，只说这里管不到。
   */
  const unknown = scan.ok ? scan.tokens.filter((t) => !FIELD_NAMES.has(t.name)).length : 0

  const set = (name: string, value: string) => onChange(setTokenValue(source, name, value))

  const groups = [...new Set(THEME_FIELDS.map((f) => f.group))]
  const primaryGroups = groups.filter((g) => PRIMARY_GROUPS.includes(g))
  const advancedGroups = groups.filter((g) => !PRIMARY_GROUPS.includes(g))

  return (
    <div className="theme-editor">
      <div className="theme-tabs" role="tablist" aria-label="主题编辑视图">
        <button type="button" role="tab" aria-selected={tab === 'gui'}
          className={'theme-tab' + (tab === 'gui' ? ' active' : '')}
          onClick={() => setTab('gui')}>外观</button>
        <button type="button" role="tab" aria-selected={tab === 'raw'}
          className={'theme-tab' + (tab === 'raw' ? ' active' : '')}
          onClick={() => setTab('raw')}>原文</button>
      </div>

      {/* 一次只呈现一个视图（也让「原文」页的 CodeMirror 永远挂在可见容器里，不必处理隐藏期的量测） */}
      {tab === 'gui' ? (
      <div className="theme-body" role="tabpanel">
        {!scan.ok ? (
          <p className="theme-unparsable" role="alert">
            这个文件的写法本编辑器看不懂（{scan.reason}），已停用「外观」编辑以免改坏你的文件。请切到「原文」页手改。
          </p>
        ) : (
          <>
            <section className="theme-group">
              <h3 className="theme-group-title">预置主题</h3>
              <p className="theme-preset-hint">点一套即换整体风格；只改动配色与排印那几行，你的注释与自定义样式原样保留。</p>
              <div className="theme-presets">
                {THEME_PRESETS.map((p) => (
                  <button key={p.name} type="button" className="theme-preset" disabled={readOnly}
                    title={p.blurb} onClick={() => {
                      // 已是这一套时点击不该留下「未保存」的幻影改动，也不必重跑预览
                      const next = applyPreset(source, p)
                      if (next !== source) onChange(next)
                    }}>
                    <span className="theme-preset-swatch" aria-hidden="true" style={{
                      background: p.tokens['--kiny-page-bg'],
                      borderColor: p.tokens['--kiny-control-border'],
                    }}>
                      <span style={{ color: p.tokens['--kiny-text'], fontFamily: p.tokens['--kiny-prose-font'] }}>文</span>
                    </span>
                    <span className="theme-preset-name">{p.name}</span>
                    <span className="theme-preset-blurb">{p.blurb}</span>
                  </button>
                ))}
              </div>
            </section>
            {primaryGroups.map((g) => (
              <section key={g} className="theme-group">
                <h3 className="theme-group-title">{g}</h3>
                {THEME_FIELDS.filter((f) => f.group === g).map((f) => (
                  <FieldRow key={f.name} field={f} value={valueOf(f.name)} fonts={fonts} disabled={readOnly}
                    onSet={(v) => set(f.name, v)} />
                ))}
              </section>
            ))}

            {/* 进阶默认收起：不懂 css 的作者一眼只看见常用的六项，想深入的人展开即可 */}
            <section className="theme-group">
              <button type="button" className="theme-advanced-toggle" aria-expanded={advancedOpen}
                aria-controls="theme-advanced" onClick={() => setAdvancedOpen((v) => !v)}>
                <span className="theme-advanced-caret" aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span>
                进阶（{advancedGroups.join(' / ')}）
              </button>
              {advancedOpen && <div id="theme-advanced">{advancedGroups.map((g) => (
                <div key={g} className="theme-subgroup">
                  <h4 className="theme-subgroup-title">{g}</h4>
                  {THEME_FIELDS.filter((f) => f.group === g).map((f) => (
                    <FieldRow key={f.name} field={f} value={valueOf(f.name)} fonts={fonts} disabled={readOnly}
                      onSet={(v) => set(f.name, v)} />
                  ))}
                </div>
              ))}</div>}
            </section>

            {unknown > 0 && (
              <p className="theme-uncovered">
                有 {unknown} 个 <code>--kiny-</code> 变量不在本页的表里（你自定义的，或是名字拼错了），切「原文」核对。
              </p>
            )}
            {uncovered > 0 && (
              <p className="theme-uncovered">
                还有 {uncovered} 处自定义样式本页管不到，切「原文」查看与修改。
              </p>
            )}
            {scan.ok && scan.foreignTokenCount > 0 && (
              <p className="theme-uncovered">
                有 {scan.foreignTokenCount} 个换肤变量写在别的选择器里（如 <code>:root</code> / <code>html .player</code> /
                媒体查询内），本页改的可能被它们盖过——如果拖了没变化，去「原文」看看那几行。
              </p>
            )}
          </>
        )}
      </div>
      ) : (
        <div className="theme-body raw" role="tabpanel">{rawEditor}</div>
      )}
    </div>
  )
}

function FieldRow({ field, value, fonts, disabled, onSet }: {
  field: ThemeField
  value: string
  fonts: string[]
  disabled: boolean
  onSet: (value: string) => void
}) {
  const id = `theme-${field.name}`
  return (
    <div className="theme-row">
      <label className="theme-label" htmlFor={id}>{field.label}</label>
      <span className="theme-control">
        {field.kind === 'color' && <ColorControl id={id} label={field.label} value={value} alpha={field.alpha === true} disabled={disabled} onSet={onSet} />}
        {field.kind === 'font' && <FontControl id={id} value={value} fonts={fonts} disabled={disabled} onSet={onSet} />}
        {field.kind === 'numeric' && <NumericControl id={id} value={value} spec={field.spec} disabled={disabled} onSet={onSet} />}
        {field.hint && <span className="theme-hint">{field.hint}</span>}
      </span>
    </div>
  )
}

/**
 * 颜色：认得出就给取色器（`alpha` 字段另给一根透明度滑杆——半透明是这些 token 的常态，
 * 不给就只能退化成文本框）；认不出（`color-mix()` / 具名色 / `var()`）退化为文本输入。
 */
function ColorControl({ id, label, value, alpha, disabled, onSet }: {
  id: string; label: string; value: string; alpha: boolean; disabled: boolean; onSet: (v: string) => void
}) {
  const parsed = alpha ? parseColor(value) : (toHexColor(value) !== null ? parseColor(value) : null)
  if (parsed === null) {
    return <DraftInput id={id} value={value} disabled={disabled} onCommit={onSet} />
  }
  return (
    <span className="theme-color">
      {/* 当前全透明时取色要落成不透明：否则 formatColor 把任何色相都压回 transparent，
          取色器成了死控件（面板底色的默认状态正是 transparent），作者还会白得一行多余声明。 */}
      <input id={id} type="color" value={parsed.hex} disabled={disabled}
        onChange={(e) => onSet(formatColor(e.target.value, parsed.alpha || 1))} />
      {alpha && (
        <input type="range" className="theme-alpha" min={0} max={1} step={0.01} value={parsed.alpha}
          disabled={disabled} aria-label={`${label}不透明度`}
          onChange={(e) => onSet(formatColor(parsed.hex, Number(e.target.value)))} />
      )}
      <span className="theme-color-hex">{value}</span>
    </span>
  )
}

/**
 * 字体：项目内字体 + 通用族；文件里的值若不在表内，作为「（文件中）」一项列出，不被静默改掉。
 * 族名先过 `validFont` 并去重——非法族名 `buildProjectCss` 根本不注册（选了也不生效），
 * 含引号的族名拼进 `"…", serif` 还会当场把文件写成语法错误、让 GUI 自锁。
 */
function FontControl({ id, value, fonts, disabled, onSet }: {
  id: string; value: string; fonts: string[]; disabled: boolean; onSet: (v: string) => void
}) {
  const projectOpts = [...new Set(fonts)].map((f) => ({ label: f, value: `"${f}", serif` }))
  const opts = [...projectOpts, ...GENERIC_FONTS]
  const known = opts.some((o) => o.value === value)
  return (
    <select id={id} className="theme-select" value={value} disabled={disabled}
      onChange={(e) => onSet(e.target.value)}>
      {!known && <option value={value}>{value}（文件中）</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/** 数值：认得出数字、且落在滑杆量程内才给滑杆，否则（`clamp()` / 超量程）退化为文本输入。 */
function NumericControl({ id, value, spec, disabled, onSet }: {
  id: string; value: string; disabled: boolean
  spec: { min: number; max: number; step: number; unit: string }; onSet: (v: string) => void
}) {
  const n = toNumber(value, spec.unit)
  // 超量程时若还给滑杆，DOM 会把它夹到端点、与旁边显示的原值对不上——宁可给文本框。
  if (n === null || n < spec.min || n > spec.max) {
    return <DraftInput id={id} value={value} disabled={disabled} onCommit={onSet} />
  }
  return (
    <span className="theme-numeric">
      <input id={id} type="range" min={spec.min} max={spec.max} step={spec.step} value={n} disabled={disabled}
        onChange={(e) => onSet(`${e.target.value}${spec.unit}`)} />
      <span className="theme-numeric-val">{value}</span>
    </span>
  )
}
