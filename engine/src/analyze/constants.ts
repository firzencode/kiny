/** §12.1 内置函数名：保留标识符。 */
export const BUILTINS = new Set([
  'random', 'seed_random', 'turns', 'turns_since',
  'seq', 'cycle', 'once', 'shuffle',
])

/** §11.1 内置命令名。 */
export const COMMAND_NAMES = new Set([
  'bg_show', 'bg_hide', 'bgm_play', 'bgm_pause', 'bgm_stop',
  'sfx', // 一次性音效（区别于循环 bgm）
  'clear', // 清屏：清除已显示正文（保留背景 / BGM），宿主落地
  'step_mode', // 推进模式：line=逐行等点击 / flow=一路流到选项（默认），宿主落地
  'text_speed', // 打字机出字速度（字 / 秒；0=瞬显），宿主落地
  'text_fade', // 每字淡入时长（毫秒），宿主落地
  'input', // 唯一的交互命令：暂停请求读者文本，写回变量（engine 内部处理，不透传），见 checks/commands.ts 特判
])

/** §6 JS 内建全局白名单（保守，按需扩充）。 */
export const JS_GLOBALS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'NaN', 'Infinity',
])

/** §7 ASCII 标识符规则（变量名 / 标签 / 参数名）。 */
export const ASCII_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
