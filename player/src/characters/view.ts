import type { RichSpan } from '@kiny/engine'
import type { LogEntry, PlayState } from '../driver/storyDriver'
import type { HostState } from '../host/commands'
import type { CharacterTable } from './table'
import { colorizeLine } from './speaker'

/** 播放视口的三处 spans（着色后）。 */
export interface CharacterView {
  log: LogEntry[]
  choices: PlayState['choices']
  panels: HostState['panels']
}

/**
 * 着色结果按**原 spans 数组的引用**缓存。
 *
 * 这不是性能优化，是**正确性所必需**：`RevealingLine` 用 `useMemo(…, [spans])` 把一行拆成
 * 逐字单元，再以 `cells` 作为「换行了没有」的判据重置打字机。着色若每次都造新数组，正在
 * 揭示的那一行会在每次 `state` 变化时被判成「新的一行」、从头重放——读者看到台词反复重打。
 *
 * 键是原数组引用，故 log 里没变的历史行天然命中；`table` 一并比对，作者在 editor 里改
 * `characters.json` 时结果照常刷新。WeakMap 让被丢弃的行自然回收。
 */
const colorized = new WeakMap<RichSpan[], { table: CharacterTable; out: RichSpan[] }>()

function colorizeCached(spans: RichSpan[], table: CharacterTable): RichSpan[] {
  const hit = colorized.get(spans)
  if (hit !== undefined && hit.table === table) return hit.out
  const out = colorizeLine(spans, table)
  colorized.set(spans, { table, out })
  return out
}

/**
 * 对播放态的三处 spans（正文 / 选项 / 固定栏）统一过一遍着色——现有富文本标签本就三处通吃，
 * 角色色不该只作用于正文。对话式选项（`<克里斯托弗> 那我跟你走`）因此也能着色。
 *
 * **必须在渲染入口做、不能做在 `RichText` 里**：最新一行走 `RevealingLine` 逐字揭示、绕开
 * `RichText`，只改后者会让正在打字的那行不着色、打完才跳成彩色。
 *
 * 无角色声明时原样返回同一批引用，避免制造无谓的重渲染。
 */
export function applyCharactersToView(state: PlayState, table: CharacterTable): CharacterView {
  if (table.size === 0) {
    return { log: state.log, choices: state.choices, panels: state.host.panels }
  }
  const t = (spans: RichSpan[]) => colorizeCached(spans, table)
  // 逐处「没变就还原引用」：`colorizeLine` 对无标注的行返回同一数组，据此让不含台词的
  // 条目 / 整个 panels 对象保持引用不变，下游组件不必为一次无效着色重渲染。
  let panelsChanged = false
  const panels: HostState['panels'] = {}
  for (const [slot, spans] of Object.entries(state.host.panels)) {
    if (!spans) continue
    const next = t(spans)
    if (next !== spans) panelsChanged = true
    panels[slot as keyof HostState['panels']] = next
  }
  return {
    // 非 narration 条目（image / divider / end）无 spans，原样保留同一引用
    // （身份即 StoryLog 的上报判重键，换引用会让它误判成新内容，见 log-entry-must-report-revealed）。
    log: state.log.map((e) => {
      if (e.kind !== 'narration') return e
      const spans = t(e.spans)
      return spans === e.spans ? e : { ...e, spans }
    }),
    choices: state.choices.map((c) => {
      const spans = t(c.spans)
      return spans === c.spans ? c : { ...c, spans }
    }),
    panels: panelsChanged ? panels : state.host.panels,
  }
}
