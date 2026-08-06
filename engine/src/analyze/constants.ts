/** §12.1 内置函数名：保留标识符。 */
export const BUILTINS = new Set([
  'random', 'seed_random', 'turns', 'turns_since',
  'seq', 'cycle', 'once', 'shuffle',
])

/** 引擎保留名（非函数的内置成员）：可引用，但声明 / 赋值均报 error。 */
export const RESERVED_NAMES = new Set(['$nodes'])

/** §11.1 内置命令名。 */
export const COMMAND_NAMES = new Set([
  'bg_show', 'bg_hide', 'bgm_play', 'bgm_pause', 'bgm_stop',
  'sfx', // 一次性音效（区别于循环 bgm）
  'img', // 正文插图：随正文流的一条内容（区别于始终垫底的全屏背景 bg_show），宿主落地
  'clear', // 清屏：清除已显示正文（保留背景 / BGM），宿主落地
  'step_mode', // 推进模式：line=逐行等点击 / flow=一路流到选项（默认），宿主落地
  'text_speed', // 打字机出字速度（字 / 秒；0=瞬显），宿主落地
  'text_fade', // 每字淡入时长（毫秒），宿主落地
  'sleep', // 演出停顿（毫秒）：在输出流中插入不可跳过的定时停顿，宿主落地
  'panel', // 固定区域（side/bottom/after）活模板登记：engine 内部处理、不透传，见 checks/commands.ts 特判
  'input', // 唯一的交互命令：暂停请求读者文本，写回变量（engine 内部处理，不透传），见 checks/commands.ts 特判
])

/**
 * §6 JS 内建全局白名单（保守，按需扩充）。
 * 容器类：`Map`/`Set`/`Date` 经快照白名单编解码存读档保真（T076）；`WeakMap`/`WeakSet` 可用但
 * 内容不可枚举、存档会丢，由 analyze `non-json-global` warning 提示（见 checks/non-json-globals.ts）。
 */
export const JS_GLOBALS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'Map', 'Set', 'WeakMap', 'WeakSet',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'NaN', 'Infinity',
])

/** §7 ASCII 标识符规则（变量名 / 标签 / 参数名）。 */
export const ASCII_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
