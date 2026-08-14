/** 角色表的约定名文件（项目根相对；与 `theme.css` 同一性质）。 */
export const CHARACTERS_FILE = 'characters.json'

/**
 * 角色名 → 生效颜色（CSS 颜色串）。**保序**：键顺序即 `characters.json` 的声明顺序，
 * 也就是自动配色的槽位顺序——增删角色时保序，否则已有角色的颜色会跳。
 */
export type CharacterTable = ReadonlyMap<string, string>

/** 八个色相槽，色相环均分。角色按声明顺序取槽，第九个起循环复用。 */
export const SLOT_HUES = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * 第 n 个槽位的自动色：**明度借当前主题的正文色、色相取固定槽位**。
 *
 * - `l` 取自 `--kiny-text` —— 明度与正文文字同级，而正文的可读性已由主题保证。四套内置主题
 *   以及作者自己在 `theme.css` 里拖出来的任意底色，角色色都自动跟着走。
 * - 色相是**字面量**、不从正文色继承 —— 内置主题的正文色都接近中性灰（色相未定义），任何
 *   `calc(h + …)` 的写法都会失败。
 * - 槽位固定而非按角色总数均分 —— 加一个角色不会让已有角色的颜色全部改变；作者调整声明
 *   顺序才会换色，这是可预期的。
 *
 * chroma `0.11`：足够分辨、又不至于在正文里刺眼。
 */
export function slotColor(index: number): string {
  return `oklch(from var(--kiny-text) l 0.11 ${SLOT_HUES[index % SLOT_HUES.length]})`
}

/**
 * 八个槽位色的 sRGB 近似（按 L=0.75 算出的 `oklch(… 0.11 <槽位色相>)`）。
 *
 * 真正生效的是 `slotColor` 那个式子——明度随主题正文色走，这里的定值只是**取色器的起始值**：
 * 编辑器里把某个角色从「自动」改成「固定色」时，得先有一个具体的 hex 放进 `<input type="color">`，
 * 而相对颜色语法在那里表达不了。取本槽位的近似色，作者看到的是「就是刚才那个颜色，现在钉住了」，
 * 而不是凭空冒出来一个灰。
 */
export const SLOT_HEX_APPROX = ['#e790ab', '#e89772', '#c9ab56', '#90be76', '#4ec5b1', '#54bce2', '#93aaf4', '#c898de']

/** 第 n 个槽位的自动色在取色器里的起始 hex。 */
export function slotHexApprox(index: number): string {
  return SLOT_HEX_APPROX[index % SLOT_HEX_APPROX.length]!
}

/** 角色名里不允许出现的字符：尖括号会让标记闭不上，冒号会让两种写法互相咬。 */
const FORBIDDEN_IN_NAME = /[<>:：\r\n]/

/**
 * 相对颜色语法 `oklch(from …)` 是否可用（旧 WebView——尤其老版本 Android WebView——可能不支持）。
 * 模块级探测一次：同一次运行里结果不会变，而这函数在渲染路径上会被反复问到。
 */
let probed: boolean | null = null
export function supportsRelativeColor(): boolean {
  if (probed === null) {
    probed = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      && CSS.supports('color', 'oklch(from white l c h)')
  }
  return probed
}

/**
 * `characters.json` 文本 → 角色表。**任何解析失败都返回空表、绝不抛**——着色是锦上添花，
 * 不该让作品打不开。形状不对的单条被丢弃、其余照常（编辑器里另给作者提示）。
 *
 * `autoColor` 为假（相对颜色语法不可用）时，只留作者写死了 `color` 的角色，其余不着色——
 * 台词行退回正文色，仍完整可读，只是失去区分。缺省按运行环境探测。
 */
export function parseCharacters(
  text: string | null | undefined,
  opts?: { autoColor?: boolean },
): CharacterTable {
  const autoColor = opts?.autoColor ?? supportsRelativeColor()
  const table = new Map<string, string>()
  if (typeof text !== 'string' || text.trim() === '') return table
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return table }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return table

  let slot = 0
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (name === '' || FORBIDDEN_IN_NAME.test(name)) continue
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const color = (value as { color?: unknown }).color
    if (typeof color === 'string' && color.trim() !== '') {
      table.set(name, color.trim())
      // 写死颜色的角色照常占一个槽：作者后来把它改成自动分配时，别人的颜色不跟着跳。
      slot += 1
      continue
    }
    if (autoColor) table.set(name, slotColor(slot))
    slot += 1
  }
  return table
}
