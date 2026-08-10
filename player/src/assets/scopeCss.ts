/**
 * 把作品 css 限定到某个容器：每条**顶层**选择器改写为 `:where(<scope>) <选择器>`，
 * `:root` / `html` / `body` 映射为容器自身。只有 editor 预览需要这道限定——那里播放器只是
 * 编辑器窗口里的一块，而 `<style>` 的规则是文档全局的；viewer / shelf / reader 整页或整屏
 * 即播放器，`body {}` 在那里本就是合法写法。
 *
 * 前缀恒用 `:where()`（特异性 0）：**前缀本身**不改变任何规则的权重，作者 css 内部的相对
 * 层叠与不加前缀时一致。裸类前缀会给每条规则凭空加一个类的权重，作者原本赢不了播放层默认
 * 样式的规则会在预览里反而赢，所见即不再是所得。
 * （一处不等价：根选择器替换会丢掉它们自身的权重——`body p` 从 (0,0,2) 变 (0,0,1)、
 * `:root` 从 (0,1,0) 变 (0,0,0)。涉及根选择器的规则与其它规则的相对优先级因此可能与
 * 播放宿主不同。作品 token 覆盖不受影响：那条走变量继承取最近祖先，不比特异性。）
 *
 * 只改顶层：嵌套规则的选择器相对其父解析，父被限定即整棵子树受限。
 */

/** 内部直接放规则的 at-rule —— 递归进去限定。 */
const NESTING_AT = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style'])
/**
 * 内部是声明而非选择器的 at-rule —— 原样放过。
 * **未列入这两张表的带块 at-rule 一律整块丢弃**：它内部可能承载选择器（`@starting-style`
 * 就是这么冒出来的），限定不了的东西不能放行。代价是新 at-rule 在预览里失效（viewer 里照常），
 * 补进表里即可；反过来放行则是拿「编辑器界面绝不受影响」这条硬保证去赌。
 */
const OPAQUE_AT = new Set([
  'font-face', 'keyframes', '-webkit-keyframes', '-moz-keyframes', '-o-keyframes',
  'property', 'counter-style', 'page', 'font-feature-values', 'font-palette-values', 'viewport',
])
/** 作者心目中的「页面根」，在预览里映射为容器自身。 */
const ROOT_PSEUDO = ':root'
const ROOT_TYPES = new Set(['html', 'body'])
/** 选择器前可以垫的东西：空白与注释。 */
const LEAD = /^(?:\s|\/\*[\s\S]*?\*\/)*/

/** 注释结束后的下标；未闭合时到末尾。 */
function skipComment(css: string, i: number): number {
  const end = css.indexOf('*/', i + 2)
  return end === -1 ? css.length : end + 2
}

/**
 * 字符串结束后的下标。**未转义换行处即结束**（CSS 的 bad-string，与浏览器一致）——
 * 作者少打一个右引号时，浏览器认为字符串到行尾就断了、其后是顶层规则；扫描器若一路找到
 * 下一个引号，就会把那些规则当成串内文本原样吐出去 = 未限定的规则进了文档。
 */
function skipString(css: string, i: number): number {
  const quote = css[i]
  let j = i + 1
  while (j < css.length) {
    const c = css[j]
    if (c === '\\') { j += css[j + 1] === '\r' && css[j + 2] === '\n' ? 3 : 2; continue }
    if (c === '\n' || c === '\r' || c === '\f') return j // 不消费换行本身，其后照常参与扫描
    if (c === quote) return j + 1
    j++
  }
  return css.length
}

/**
 * 未加引号的 `url(…)` 是**一个整 token**：里面的引号不开字符串、花括号不参与配对
 * （CSS 词法的 url-token / bad-url-token）。引号形式 `url("…")` 交给普通字符串逻辑。
 */
function skipUrl(css: string, i: number): number {
  let j = i + 4 // 跳过 `url(`
  while (j < css.length && /\s/.test(css[j]!)) j++
  if (css[j] === '"' || css[j] === "'") return i + 4 // 引号形式：从 `(` 后继续走常规扫描
  while (j < css.length) {
    if (css[j] === '\\') { j += 2; continue }
    if (css[j] === ')') return j + 1
    j++
  }
  return css.length
}

/**
 * 若 `css[i]` 起是一个必须**整体跳过**的原子（注释 / 字符串 / 未加引号 url() / 转义字符），
 * 返回跳过后的下标；否则返回 -1。
 * 四个扫描器共用这一个口径——词法一旦在某处与浏览器分叉，那里就是一个漏限定的入口。
 */
function atom(css: string, i: number): number {
  const c = css[i]
  if (c === '/' && css[i + 1] === '*') return skipComment(css, i)
  if (c === '"' || c === "'") return skipString(css, i)
  if (c === '\\') return i + 2 // 串外转义：`.a\{b` 里的 `{` 不是块起始
  if ((c === 'u' || c === 'U') && /^url\(/i.test(css.slice(i, i + 4))) return skipUrl(css, i)
  return -1
}

/** 与 `css[open]`（`{`）配对的 `}` 的下标；未闭合时返回 `css.length`。 */
function findBlockEnd(css: string, open: number): number {
  let depth = 0
  let i = open
  while (i < css.length) {
    const e = atom(css, i)
    if (e !== -1) { i = e; continue }
    const c = css[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
    i++
  }
  return css.length
}

/** 顶层逗号拆选择器列表（括号 / 方括号 / 字符串 / 注释里的逗号不算）。 */
function splitSelectors(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < list.length) {
    const e = atom(list, i)
    if (e !== -1) { i = e; continue }
    const c = list[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1 }
    i++
  }
  out.push(list.slice(start))
  return out
}

/**
 * ident 字符：ASCII 词字符 + 连字符 + 一切非 ASCII（中文类名合法）。
 * 用码点比较而非正则字符类——后者的非 ASCII 上下界只能写成不可见字符，
 * 一次编码转换或「清理不可见空白」的批量替换就会静默改掉它的语义。
 */
function isIdent(ch: string | undefined): boolean {
  if (ch === undefined) return false
  const c = ch.charCodeAt(0)
  return c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127
}

/**
 * 把选择器里深度 0 处的 `:root` / `html` / `body` 换成前缀。
 * `html` / `body` 只认**类型选择器位置**（前面是开头或组合器），故 `.body`、`.bodyguard`、
 * `[x="body"]` 都不误伤。括号内（`:is(html, .x)`）不处理——那种写法换不换都匹配不上，
 * 保持规则简单可预测。
 */
function replaceRoots(sel: string, prefix: string): string {
  let out = ''
  let depth = 0
  let i = 0
  let prev = ''
  while (i < sel.length) {
    const a = atom(sel, i)
    if (a !== -1) { out += sel.slice(i, a); prev = sel[a - 1] ?? prev; i = a; continue }
    const c = sel[i]!
    if (c === '(' || c === '[') { depth++; out += c; prev = c; i++; continue }
    if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); out += c; prev = c; i++; continue }
    if (depth === 0) {
      if (c === ':' && sel.startsWith(ROOT_PSEUDO, i) && !isIdent(sel[i + ROOT_PSEUDO.length])) {
        out += prefix
        i += ROOT_PSEUDO.length
        prev = ')'
        continue
      }
      if ((prev === '' || ' >+~,'.includes(prev)) && isIdent(c)) {
        let j = i
        while (isIdent(sel[j])) j++
        if (ROOT_TYPES.has(sel.slice(i, j).toLowerCase())) {
          out += prefix
          i = j
          prev = ')'
          continue
        }
      }
    }
    out += c
    prev = /\s/.test(c) ? ' ' : c
    i++
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `html body` / `html > body` 说的是同一个盒子（页面根），替换后会得到两截前缀、
 * 变成「容器里的容器」而永不匹配。折叠成一截。
 */
function collapseRoots(sel: string, prefix: string): string {
  const p = escapeRe(prefix)
  const pair = new RegExp(`${p}(?:\\s*>?\\s*)${p}`)
  let out = sel
  while (pair.test(out)) out = out.replace(pair, prefix)
  return out
}

/**
 * 已经以容器打头、无需再加前缀的选择器。
 * **兄弟组合器例外**：`body ~ .foo` 替换后是 `:where(.preview-stage) ~ .foo`，匹配的是容器的
 * **兄弟**——预览工具条与运行时错误横幅正是容器的兄弟，那等于直接命中编辑器界面。这种写法照常
 * 再加一层前缀，让它退化成「容器内的容器的兄弟」而永不匹配：安全失败胜过越界生效。
 */
function startsWithScope(sel: string, prefix: string): boolean {
  if (!sel.startsWith(prefix)) return false
  // 必须扫完**整个**第一个复合选择器再看组合器：`body:not(.zz) ~ .x` 替换后是
  // `:where(容器):not(.zz) ~ .x`，只看紧跟前缀的一个字符会误判成安全。
  return !isSibling(sel[skipLead(sel, endOfCompound(sel, prefix.length))])
}

const isSibling = (ch: string | undefined): boolean => ch === '~' || ch === '+'

/** 跳过从 `i` 起的空白与注释——注释在词法阶段就被丢弃，`body/* c *\/~ .x` 与 `body ~ .x` 等价。 */
function skipLead(s: string, i: number): number {
  return i + LEAD.exec(s.slice(i))![0].length
}

/** 从 `i` 起扫完一个复合选择器（类 / 伪类 / 属性等附加条件），停在深度 0 的组合器或逗号前。 */
function endOfCompound(sel: string, i: number): number {
  let depth = 0
  while (i < sel.length) {
    const e = atom(sel, i)
    if (e !== -1) { i = e; continue }
    const c = sel[i]!
    if (c === '(' || c === '[') { depth++; i++; continue }
    if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); i++; continue }
    if (depth === 0 && (/\s/.test(c) || c === '>' || c === '~' || c === '+' || c === ',')) return i
    i++
  }
  return i
}

/** 给一条选择器加前缀，前导注释 / 空白与尾随空白原样留在原位。 */
function scopeOne(raw: string, prefix: string): string {
  const lead = LEAD.exec(raw)![0]
  const rest = raw.slice(lead.length)
  const trail = /\s*$/.exec(rest)![0]
  const core = rest.slice(0, rest.length - trail.length)
  if (core === '') return raw
  const sel = collapseRoots(replaceRoots(core, prefix), prefix)
  // 以兄弟组合器打头的选择器在顶层本不合法（浏览器整条丢弃），只加一截前缀反倒让它变合法、
  // 命中容器的兄弟。与根选择器带兄弟组合器同样处置：套两截，退化成永不匹配。
  if (isSibling(core[0])) return lead + `${prefix} ${prefix} ${sel}` + trail
  return lead + (startsWithScope(sel, prefix) ? sel : `${prefix} ${sel}`) + trail
}

/**
 * at-rule 名（不含 `@`）；非 at-rule 返回空串。
 * **必须先跳过前导注释**：`buildProjectCss` 给每份 css 都加一行「文件路径」头注释，
 * 故生产输入永远以注释开头。只 trim 空白的话，`@import` 剥离与 at-rule 识别在真实路径上
 * 全部失效——`@import` 原样留下（未限定的 css 进了文档），`@media` 被当成选择器加前缀
 * 而整块作废。
 */
function atName(prelude: string): string {
  const m = /^@([-\w]+)/.exec(prelude.slice(LEAD.exec(prelude)![0].length))
  return m ? m[1]!.toLowerCase() : ''
}

/** 一段语句式片段：`@import` 只剩它前面的注释 / 空白，其余原样。 */
function drop(stmt: string): string {
  return atName(stmt) === 'import' ? LEAD.exec(stmt)![0] : stmt
}

function scopeRules(css: string, prefix: string): string {
  let out = ''
  let start = 0
  let i = 0
  while (i < css.length) {
    const e = atom(css, i)
    if (e !== -1) { i = e; continue }
    const c = css[i]!
    if (c === '{') {
      const prelude = css.slice(start, i)
      const end = findBlockEnd(css, i)
      const body = css.slice(i + 1, end)
      const at = atName(prelude)
      if (at === '') out += splitSelectors(prelude).map((s) => scopeOne(s, prefix)).join(',') + '{' + body + '}'
      else if (NESTING_AT.has(at)) out += prelude + '{' + scopeRules(body, prefix) + '}'
      else if (OPAQUE_AT.has(at)) out += prelude + '{' + body + '}'
      else out += LEAD.exec(prelude)![0] // 未知带块 at-rule：整块丢弃，只留它前面的注释与空白
      // 未闭合（end 落在末尾）时上面那个 `}` 是补的，原文没有——去掉。
      if (end === css.length) return out.slice(0, -1)
      i = end + 1
      start = i
      continue
    }
    if (c === ';' || c === '}') {
      // `@import` 引入的规则限定不到，是唯一能把未限定 css 带进文档的口子——剥离语句本身，
      // 但保留它前面的注释与空白（那是上一条规则与它之间的原文，与 @import 无关）。
      out += drop(css.slice(start, i + 1))
      i++
      start = i
      continue
    }
    i++
  }
  return out + drop(css.slice(start))
}

/**
 * 用**浏览器自己的解析器**复核产出：每条样式规则的选择器都必须以前缀打头。
 *
 * 手写扫描器与浏览器的词法只要有一处偏差，那里就是一个漏限定的入口——与其逐个补，不如让
 * 权威解析器把关。构造式样式表不可用时（如 jsdom）跳过；那种环境本就不渲染样式，没有可污染
 * 的界面，真正要守的是编辑器运行时。
 *
 * 返回 false = 产出里有越界规则，调用方应当整份丢弃。
 */
function verifyScoped(out: string, prefix: string): boolean {
  const Sheet = (globalThis as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet
  if (typeof Sheet !== 'function') return true
  let sheet: CSSStyleSheet
  try {
    sheet = new Sheet()
    ;(sheet as CSSStyleSheet & { replaceSync?: (t: string) => void }).replaceSync?.(out)
  } catch {
    return true // 环境不支持构造式样式表：跳过复核，不因此丢掉作者样式
  }
  const ok = (rules: CSSRuleList | undefined): boolean => {
    if (!rules) return true
    for (const rule of Array.from(rules)) {
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules
      const selector = (rule as CSSRule & { selectorText?: string }).selectorText
      // 有选择器的规则：每一段都必须以容器前缀打头。`@keyframes` 的 `from`/`to` 也带
      // selectorText，但它挂在 CSSKeyframesRule 下、本就不该检查——故先看有无子规则。
      if (nested) { if (!ok(nested)) return false; continue }
      if (typeof selector === 'string' && selector !== '') {
        for (const one of selector.split(',')) if (!one.trim().startsWith(prefix)) return false
      }
    }
    return true
  }
  try {
    return ok(sheet.cssRules)
  } catch {
    return true // 跨源等原因读不到 cssRules：不据此丢弃
  }
}

/**
 * `scope` 传裸选择器（如 `.preview-stage`），`:where()` 由本函数包——调用方无从忘记。
 *
 * `@font-face` 的族名、`@keyframes` 的动画名属全局命名空间，选择器限定管不到（已知边界）。
 *
 * 失败关闭：扫描异常、或产出经浏览器解析后仍有越界规则，都返回空串——宁可预览不上样式，
 * 也绝不把未限定的 css 放进文档。
 */
export function scopeCss(css: string, scope: string): string {
  const prefix = `:where(${scope})`
  try {
    const out = scopeRules(css, prefix)
    return verifyScoped(out, prefix) ? out : ''
  } catch {
    return ''
  }
}
