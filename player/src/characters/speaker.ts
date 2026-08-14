import type { RichSpan } from '@kiny/engine'
import type { CharacterTable } from './table'

/** 首个 span 的文本；首个 span 不是文本 span（或空行）时返回 null。 */
function headText(spans: readonly RichSpan[]): string | null {
  const first = spans[0]
  return first !== undefined && 'text' in first ? first.text : null
}

/**
 * 认出行首的说话人标注，返回**已声明**的角色名；无标注或未声明 → null。
 *
 * 两种写法形状完全不同、识别时互不干扰，作者可混用：
 * - 尖括号 `<名字>`：尖括号紧包名字（名字前后无空格），精确匹配，不存在歧义。
 * - 冒号 `名字：` / `名字:`：多个角色名有前缀包含关系时（声明了「林」又声明了「林然」）取最长匹配。
 *
 * **只有声明过的名字才触发**——这条让整个功能不需要任何新的转义规则：正文里的「他说：」
 * 「时间：三点二十」一概不匹配。冒号在 Kin 里本就没有特殊含义，本模块也不给它特殊含义。
 */
export function matchSpeaker(spans: readonly RichSpan[], table: CharacterTable): string | null {
  if (table.size === 0) return null
  const head = headText(spans)
  if (head === null) return null

  // 尖括号：取第一个 `>` 之前的那段查表。天然要求紧包——名字前后有空格就查不到。
  if (head.startsWith('<')) {
    const close = head.indexOf('>')
    if (close > 1) {
      const name = head.slice(1, close)
      if (table.has(name)) return name
    }
    return null
  }

  // 冒号：遍历取最长匹配。角色表规模是个位数量级，逐条比对足够。
  let best: string | null = null
  for (const name of table.keys()) {
    if (best !== null && name.length <= best.length) continue
    if (head.startsWith(`${name}：`) || head.startsWith(`${name}:`)) best = name
  }
  return best
}

/**
 * 给一行 spans 按说话人着色：匹配成功则该行**所有**尚无颜色的文本 span 着该角色的颜色。
 * 标记原样显示——本模块完全不改文本，只加颜色。
 *
 * **作者的显式指定优先**：span 已经带 `<color=…>` 时保留作者写的颜色，自动着色只填补空缺。
 *
 * 无匹配（含空表）时返回**同一引用**——渲染路径上反复调用，不该制造无谓的重渲染。
 */
export function colorizeLine(spans: RichSpan[], table: CharacterTable): RichSpan[] {
  const name = matchSpeaker(spans, table)
  if (name === null) return spans
  const color = table.get(name)!
  return spans.map((s) => ('text' in s && s.color === undefined ? { ...s, color } : s))
}
