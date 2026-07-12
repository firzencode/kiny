/**
 * 快捷键键位模型：规范化 / 格式化 / 解析 / 可绑校验。
 *
 * 内部统一用规范串（canonical）：修饰键固定序 `Mod` `Alt` `Shift` + 主键，`+` 连接。
 * - `Mod` = 平台元键（Windows/Linux 的 Ctrl、macOS 的 ⌘），与全局 keydown 的 `ctrlKey||metaKey` 对齐。
 * - 主键：单字符大写（`s`→`S`）、`+`→`=`（规避分隔符歧义）、功能键 `F1`–`F12` 原样。
 * 例：`Mod+S`、`Mod+Alt+S`、`Mod+/`、`F1`。
 */

const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** 是否 macOS（显示 ⌘/⌥/⇧ 与连接符差异用）。 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const s = navigator.platform || navigator.userAgent || ''
  return /Mac|iPhone|iPad|iPod/.test(s)
}

/** 规范化主键：单字符大写、`+`→`=`；多字符键（F1/Enter/...）原样。 */
function normKey(key: string): string {
  if (key.length === 1) {
    const up = key.toUpperCase()
    return up === '+' ? '=' : up
  }
  return key
}

/** KeyboardEvent → 规范串；纯修饰键按下返回空串（非完整组合）。 */
export function normalize(e: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): string {
  if (MOD_KEYS.has(e.key)) return ''
  // `+`（主行由 Shift+= 产生 / 数字键盘直出）归一为 `=` 后一并丢弃 Shift：
  // 使「Ctrl++」与「Ctrl+=」等价，保放大字号语义与旧行为一致。
  const isPlus = e.key === '+'
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && !isPlus) parts.push('Shift')
  parts.push(normKey(e.key))
  return parts.join('+')
}

export interface Combo {
  mod: boolean
  alt: boolean
  shift: boolean
  key: string
}

/** 规范串 → 结构。 */
export function parse(canonical: string): Combo {
  const parts = canonical.split('+')
  const key = parts[parts.length - 1] ?? ''
  const set = new Set(parts.slice(0, -1))
  return { mod: set.has('Mod'), alt: set.has('Alt'), shift: set.has('Shift'), key }
}

const FN_RE = /^F([1-9]|1[0-2])$/

/** 规范串 → 显示串（平台化 Ctrl/⌘）。 */
export function format(canonical: string, mac: boolean = isMac()): string {
  const c = parse(canonical)
  const seq: string[] = []
  if (c.mod) seq.push(mac ? '⌘' : 'Ctrl')
  if (c.alt) seq.push(mac ? '⌥' : 'Alt')
  if (c.shift) seq.push(mac ? '⇧' : 'Shift')
  seq.push(c.key)
  return seq.join(mac ? '' : '+')
}

/** 规范串 → CodeMirror keymap 键名（`Mod+/` → `Mod-/`）。 */
export function toCmKey(canonical: string): string {
  return canonical.replace(/\+/g, '-')
}

/**
 * 可绑校验：须带修饰键（Ctrl/⌘/Alt），唯一例外 F1–F12 允许裸键——
 * 防止把普通字母绑成快捷键吞掉正文输入。Shift 单独不算充分修饰。
 */
export function isBindable(canonical: string): { ok: boolean; reason?: string } {
  const c = parse(canonical)
  if (!c.key) return { ok: false, reason: '缺少主键' }
  const isFn = FN_RE.test(c.key)
  if (!c.mod && !c.alt && !isFn) {
    return { ok: false, reason: '快捷键须带 Ctrl / ⌘ / Alt 修饰键（F1–F12 除外）' }
  }
  return { ok: true }
}
