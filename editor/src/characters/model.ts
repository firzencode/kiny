/**
 * 与内置**成对**富文本标签同名的角色名。这一档最坏：`<b> 台词` 会被解析成一个未闭合的
 * 粗体标签——既不着色，还在校验期产出 error 级诊断（编辑器标红、打包被拒）。
 */
const PAIRED_TAGS = new Set(['b', 'i', 'u', 's'])
/**
 * 与内置**自闭合**富文本标签同名的角色名。这一档温和：`<br> 台词` 解析成一个换行标签，
 * 不着色、但不产生任何诊断，作品照常读。
 */
const SELF_CLOSING_TAGS = new Set(['br', 'pause'])
/** **新增内置富文本标签时，上面两张表要跟着扩。** */
/** 角色名禁用字符：尖括号让标记闭不上，冒号让两种写法互相咬。 */
const FORBIDDEN_IN_NAME = /[<>:：\r\n]/
/**
 * 纯数字的角色名。JSON 对象的字符串键保持插入顺序——**但整数形态的键例外**，
 * `Object.entries` / `JSON.stringify` 一律把它们提到最前、按数值升序排。于是「键顺序即声明
 * 顺序即配色槽位」这条不变量在这类名字上失效：文件里写在后面的「7」会抢到第一个色槽，而
 * GUI 里给它调顺序会产出与原文一字不差的文本、按钮看着毫无反应。
 */
const NUMERIC_NAME = /^\d+$/

/** 「角色」GUI 的一行：`color` 为空串表示「自动分配」。 */
export interface CharacterRow {
  name: string
  color: string
}

export type ParseRowsResult =
  | { ok: true; rows: CharacterRow[] }
  | { ok: false; reason: string }

/**
 * `characters.json` 文本 → GUI 行模型。**只要有一处 GUI 表达不了的东西就整体不 ok**，由调用方
 * 停用 GUI 并提示切「原文」——绝不猜着写回（照搬 `ThemeEditor` 对看不懂的 css 的处置）。
 * 空文本视为空表，刚新建的文件也能直接开 GUI。
 */
export function parseRows(source: string): ParseRowsResult {
  if (source.trim() === '') return { ok: true, rows: [] }
  let raw: unknown
  try { raw = JSON.parse(source) } catch { return { ok: false, reason: '不是合法的 JSON' } }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '顶层不是一个对象' }
  }
  const rows: CharacterRow[] = []
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: `「${name}」的值不是一个对象` }
    }
    if (Object.keys(value as object).some((k) => k !== 'color')) {
      return { ok: false, reason: `「${name}」里有本编辑器还不认识的字段` }
    }
    const color = (value as { color?: unknown }).color
    if (color !== undefined && typeof color !== 'string') {
      return { ok: false, reason: `「${name}」的 color 不是一段文本` }
    }
    rows.push({ name, color: color ?? '' })
  }
  return { ok: true, rows }
}

/**
 * GUI 行模型 → `characters.json` 文本。**保序**（键顺序即自动配色的槽位），两空格缩进、尾随换行。
 */
export function formatRows(rows: CharacterRow[]): string {
  // `Object.create(null)`：普通对象上 `obj['__proto__'] = …` 走的是原型 setter、不产生自有
  // 属性，那个角色写回时会凭空消失（`JSON.parse` 倒是能把 `__proto__` 读成自有属性）。
  const obj = Object.create(null) as Record<string, { color?: string }>
  for (const r of rows) obj[r.name] = r.color === '' ? {} : { color: r.color }
  return `${JSON.stringify(obj, null, 2)}\n`
}

/** 角色名的问题：`error` 拦住写回（会把文件改坏），`warning` 照常写回、只提示。 */
export interface NameIssue {
  message: string
  level: 'error' | 'warning'
}

/**
 * 角色名的问题（null = 没问题）。空 / 含禁用字符 / 重名是**错误**——写回会让两行折成一条或让
 * 标记闭不上。与内置富文本标签同名只是**警告**：作者有权这么命名，冒号写法照常着色。
 * **错误优先于警告**（叫 `b` 又重名时先报重名）。
 */
export function nameIssue(name: string, rows: CharacterRow[], self: number): NameIssue | null {
  const err = (message: string): NameIssue => ({ message, level: 'error' })
  if (name.trim() === '') return err('角色名不能为空')
  if (FORBIDDEN_IN_NAME.test(name)) return err('角色名不能含 < > : ： 或换行')
  if (NUMERIC_NAME.test(name)) return err('角色名不能是纯数字（会打乱角色顺序，也就打乱了自动配色）')
  if (rows.some((r, i) => i !== self && r.name === name)) return err('已经有同名角色了')
  if (PAIRED_TAGS.has(name)) {
    return {
      message: `「${name}」与内置富文本标签同名：正文里写 <${name}> 台词 会被当成一个没闭合的标签、校验直接报错。这个角色请只用冒号写法，或换个名字`,
      level: 'warning',
    }
  }
  if (SELF_CLOSING_TAGS.has(name)) {
    return {
      message: `「${name}」与内置富文本标签同名，尖括号写法不生效（会被当成标签），这个角色请用冒号写法或换个名字`,
      level: 'warning',
    }
  }
  return null
}

/**
 * 整表是否可以安全写回。**只拦重名**——那是唯一会真正丢数据的情形（两行在 JSON 对象里折成
 * 一条，作者的一个角色凭空消失）。
 *
 * 空名字 / 含禁用字符 / 纯数字名同样不合法，但它们写回去不丢任何东西，只是那个角色不生效；
 * 而这类名字往往是作者手写 JSON 时留下的、文件里**本来就有**。若因为它们就锁死整表，作者
 * 会陷进一个改不动的页面：每次改动都写不回去 → 文件不变 → 重算出的行还是原样，坏名字一个
 * 也修不掉。拦新输入的坏名字是 `nameIssue` 的事（在 `setName` 里逐次拦），不是这里的事。
 */
export function canCommit(rows: CharacterRow[]): boolean {
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.name)) return false
    seen.add(r.name)
  }
  return true
}
