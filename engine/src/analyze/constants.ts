/** §12.1 内置函数名：保留标识符。 */
export const BUILTINS = new Set([
  'random', 'seed_random', 'turns', 'turns_since',
  'seq', 'cycle', 'once', 'shuffle',
])

/** §11.1 内置命令名。 */
export const COMMAND_NAMES = new Set([
  'bg_show', 'bg_hide', 'bgm_play', 'bgm_pause', 'bgm_stop',
  'sfx', // 一次性音效（区别于循环 bgm）
])

/** §6 JS 内建全局白名单（保守，按需扩充）。 */
export const JS_GLOBALS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'NaN', 'Infinity',
])

/** §7 ASCII 标识符规则（变量名 / 标签 / 参数名）。 */
export const ASCII_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
