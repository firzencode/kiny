import { useMemo, useState, type ReactNode } from 'react'
import { slotColor, slotHexApprox } from '@kiny/player'
import { DraftInput } from './DraftInput'
import { toHexColor } from '../theme/fields'
import { parseRows, formatRows, nameIssue, canCommit, type CharacterRow } from '../characters/model'

interface CharacterEditorProps {
  /** 当前 `characters.json` 缓冲全文（唯一真相）。 */
  source: string
  /** 改写后的新全文。 */
  onChange: (next: string) => void
  /**
   * 置只读（AI 运行期）：GUI 的写回是**整文件**替换，与 AI 的整篇改写互相顶掉，
   * 故此时禁用全部控件（「原文」页由 EditorPane 自己挡）。默认 false。
   */
  readOnly?: boolean
  /** 「原文」页要呈现的文本编辑器（由 App 传入，令本组件不依赖 CodeMirror、可单测）。 */
  rawEditor: ReactNode
}

/**
 * `characters.json` 的双模编辑器：「角色」是 GUI，「原文」是带高亮的文本编辑器——同一个文件、
 * 两个视图，文件始终是唯一真相。与 `ThemeEditor` 同一套范式：只改缓冲不落盘（保存走 Ctrl+S），
 * 于是白拿脏标记 / autosave 恢复 / AI 只读那一整套现成机制。
 *
 * 写回是**整文件重排**（JSON 没有「定点替换」可言，注释也无处安放），故看不懂的文件一律停用
 * GUI、提示切「原文」——绝不猜着写回。
 */
export function CharacterEditor({ source, onChange, readOnly = false, rawEditor }: CharacterEditorProps) {
  const [tab, setTab] = useState<'gui' | 'raw'>('gui')
  /**
   * 被拒收的改名（空 / 含禁用字符 / 重名）。这类名字**不写回文件**，否则重名两行会折成一条、
   * 含尖括号的名字会让标记闭不上。文件没变就没法从 `rows` 里显示问题，故单独记下来提示。
   */
  const [rejected, setRejected] = useState<{ index: number; name: string; message: string } | null>(null)
  const parsed = useMemo(() => parseRows(source), [source])
  const rows = parsed.ok ? parsed.rows : []
  /**
   * 文件里**已有**的不合法角色名（`parseRows` 只管 JSON 形状、不管名字，这类名字只可能是
   * 作者手写 JSON 时留下的）。这些角色不会生效，页面上要说清楚——但不锁死编辑，作者正是
   * 要在这里把它们改好。
   */
  const badNames = rows
    .map((r, i) => nameIssue(r.name, rows, i))
    .filter((x): x is NonNullable<typeof x> => x?.level === 'error')

  /**
   * 整表写回（返回是否真的写了）。幂等：文本没变就不 onChange，免留下幻影脏标记。
   *
   * 名字有 error 级问题时绝不写：重名两行会折成一条、纯数字名会打乱键顺序。但**不能静默
   * return**——文件里有两个坏名字时，作者改好其中一个也仍然写不回去，看到的只是按钮没反应。
   */
  const commit = (next: CharacterRow[]): boolean => {
    if (!canCommit(next)) return false
    const text = formatRows(next)
    if (text !== source) onChange(text)
    return true
  }
  const setName = (i: number, name: string) => {
    const next = rows.map((r, j) => (j === i ? { ...r, name } : r))
    const issue = nameIssue(name, next, i)
    if (issue?.level === 'error') {
      setRejected({ index: i, name, message: issue.message })
      return
    }
    // 这个名字本身没问题，但整表仍可能写不回去（`canCommit` 只会因重名拦下，而重名已在上面
    // 拦过了——这里是兜底）。不静默：否则作者看到的是「我明明改对了，却什么都没发生」。
    setRejected(commit(next) ? null : { index: i, name, message: '这一改没能保存，请切到「原文」页检查' })
  }
  const replaceAt = (i: number, patch: Partial<CharacterRow>) =>
    commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  /** 换相邻两行的位置（键顺序即自动配色的槽位，故顺序可调是有意义的）。 */
  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setRejected(null) // 行位置变了，旧的「第 i 行被拒收」提示会挂错行
    commit(next)
  }
  const addRow = () => {
    // 名字必须当场就合法（空名字是 error、会被 canCommit 拦下），故给一个不重复的占位名。
    let n = rows.length + 1
    while (rows.some((r) => r.name === `角色${n}`)) n += 1
    commit([...rows, { name: `角色${n}`, color: '' }])
  }

  return (
    <div className="theme-editor character-editor">
      <div className="theme-tabs" role="tablist" aria-label="角色编辑视图">
        <button type="button" role="tab" aria-selected={tab === 'gui'}
          className={'theme-tab' + (tab === 'gui' ? ' active' : '')}
          onClick={() => setTab('gui')}>角色</button>
        <button type="button" role="tab" aria-selected={tab === 'raw'}
          className={'theme-tab' + (tab === 'raw' ? ' active' : '')}
          onClick={() => setTab('raw')}>原文</button>
      </div>

      {tab === 'gui' ? (
        <div className="theme-body" role="tabpanel">
          {!parsed.ok ? (
            <p className="theme-unparsable" role="alert">
              这个文件的写法本编辑器看不懂（{parsed.reason}），已停用「角色」编辑以免改坏你的文件。请切到「原文」页手改。
            </p>
          ) : (
            <>
              <section className="theme-group">
                <h3 className="theme-group-title">角色</h3>
                <p className="theme-preset-hint">
                  声明过的名字才会着色。正文里写 <code>&lt;名字&gt; 台词</code> 或 <code>名字：台词</code> 都行，
                  标记原样显示。颜色留空 = 按下面的顺序自动分配，换主题也自动保持可读。
                </p>
                {rows.length === 0 && <p className="theme-hint">还没有角色。点下面的「添加角色」开始。</p>}
                {badNames.length > 0 && (
                  <p className="theme-unparsable" role="alert">
                    有 {badNames.length} 个角色名不合法（{badNames[0]!.message}），这些角色不会生效，请就地改好。
                  </p>
                )}
                {rows.map((row, i) => (
                  <CharacterRowView
                    key={i}
                    row={row}
                    index={i}
                    rows={rows}
                    disabled={readOnly}
                    first={i === 0}
                    last={i === rows.length - 1}
                    rejected={rejected?.index === i ? rejected : null}
                    onSetName={(name) => setName(i, name)}
                    onSetColor={(color) => replaceAt(i, { color })}
                    onMove={(d) => move(i, d)}
                    onDelete={() => commit(rows.filter((_, j) => j !== i))}
                  />
                ))}
                <button type="button" className="theme-advanced-toggle" disabled={readOnly} onClick={addRow}>
                  ＋ 添加角色
                </button>
              </section>
            </>
          )}
        </div>
      ) : (
        <div className="theme-body theme-body-raw" role="tabpanel">{rawEditor}</div>
      )}
    </div>
  )
}

function CharacterRowView({
  row, index, rows, disabled, first, last, rejected, onSetName, onSetColor, onMove, onDelete,
}: {
  row: CharacterRow
  index: number
  rows: CharacterRow[]
  disabled: boolean
  first: boolean
  last: boolean
  /** 本行最近一次被拒收的改名（若有）——文件里没有它，只能从这里显示。 */
  rejected: { name: string; message: string } | null
  onSetName: (name: string) => void
  onSetColor: (color: string) => void
  onMove: (delta: number) => void
  onDelete: () => void
}) {
  const id = `character-${index}`
  const issue = nameIssue(row.name, rows, index)
  const auto = row.color === ''
  // 自动色用**这一行的下标**算，与播放端同一张色相槽表（`slotColor` 从 player 导出，不抄第二份）。
  const shown = auto ? slotColor(index) : row.color
  // 取色器要一个具体 hex；自动态时取本槽位的近似色，作者点「改用固定色」得到的是「刚才那个
  // 颜色，现在钉住了」，而不是凭空一个灰。已有非 hex 值（`tomato` / `rgba(…)`）才落回中灰。
  const hex = toHexColor(row.color) ?? (auto ? slotHexApprox(index) : '#808080')

  return (
    <div className="theme-row character-row">
      <span className="character-swatch" aria-hidden="true" style={{ background: shown }} />
      <DraftInput id={id} value={row.name} disabled={disabled} onCommit={onSetName} />
      <span className="theme-control">
        {auto ? (
          <>
            <span className="theme-color-hex">自动配色</span>
            <button type="button" className="theme-select" disabled={disabled}
              onClick={() => onSetColor(hex)}>改用固定色</button>
          </>
        ) : (
          <span className="theme-color">
            <input type="color" value={hex} disabled={disabled} aria-label={`${row.name}的颜色`}
              onChange={(e) => onSetColor(e.target.value)} />
            <span className="theme-color-hex">{row.color}</span>
            <button type="button" className="theme-select" disabled={disabled}
              onClick={() => onSetColor('')}>改回自动</button>
          </span>
        )}
        <button type="button" className="theme-select" disabled={disabled || first}
          aria-label={`把${row.name}上移`} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="theme-select" disabled={disabled || last}
          aria-label={`把${row.name}下移`} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="theme-select" disabled={disabled}
          aria-label={`删除${row.name}`} onClick={onDelete}>删除</button>
      </span>
      {rejected ? (
        <p className="theme-unparsable" role="alert">{rejected.message}（这个名字没有保存）</p>
      ) : issue?.level === 'error' ? (
        <p className="theme-unparsable" role="alert">{issue.message}</p>
      ) : issue ? (
        <p className="theme-hint" role="status">{issue.message}</p>
      ) : null}
    </div>
  )
}
