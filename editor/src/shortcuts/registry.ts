/**
 * 快捷键中央注册表：单一真相源，驱动全局 keydown 派发、CodeMirror 编辑器绑定、
 * MenuBar 的 `sc` 提示、可自定义「快捷键」设置页。三处不再各写一份、不漂移。
 */

/** 稳定命令标识。 */
export type CommandId =
  | 'newProject'
  | 'openProject'
  | 'newFile'
  | 'save'
  | 'saveAll'
  | 'openSettings'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'help'
  | 'toggleComment'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'

/** 派发域：global = window keydown；editor = CodeMirror keymap。 */
export type Scope = 'global' | 'editor'

export interface CommandDef {
  id: CommandId
  label: string
  category: string
  /** 规范串默认绑定（见 keys.ts）。 */
  defaultKeys: string
  scope: Scope
  /** 原生编辑键：速查页展示但不可重绑（textarea / CM 原生处理）。 */
  readonly?: boolean
}

/** 全部命令定义（顺序即速查页展示序）。 */
export const COMMANDS: CommandDef[] = [
  { id: 'newProject', label: '新建项目', category: '文件', defaultKeys: 'Mod+N', scope: 'global' },
  { id: 'openProject', label: '打开项目', category: '文件', defaultKeys: 'Mod+O', scope: 'global' },
  { id: 'newFile', label: '新建文件', category: '文件', defaultKeys: 'Mod+Shift+N', scope: 'global' },
  { id: 'save', label: '保存', category: '文件', defaultKeys: 'Mod+S', scope: 'global' },
  { id: 'saveAll', label: '全部保存', category: '文件', defaultKeys: 'Mod+Alt+S', scope: 'global' },
  { id: 'openSettings', label: '设置', category: '文件', defaultKeys: 'Mod+,', scope: 'global' },
  { id: 'toggleComment', label: '注释 / 取消注释当前行', category: '编辑', defaultKeys: 'Mod+/', scope: 'editor' },
  { id: 'undo', label: '撤销', category: '编辑', defaultKeys: 'Mod+Z', scope: 'editor', readonly: true },
  { id: 'redo', label: '重做', category: '编辑', defaultKeys: 'Mod+Y', scope: 'editor', readonly: true },
  { id: 'cut', label: '剪切', category: '编辑', defaultKeys: 'Mod+X', scope: 'editor', readonly: true },
  { id: 'copy', label: '复制', category: '编辑', defaultKeys: 'Mod+C', scope: 'editor', readonly: true },
  { id: 'paste', label: '粘贴', category: '编辑', defaultKeys: 'Mod+V', scope: 'editor', readonly: true },
  { id: 'selectAll', label: '全选', category: '编辑', defaultKeys: 'Mod+A', scope: 'editor', readonly: true },
  { id: 'zoomIn', label: '放大字号', category: '视图', defaultKeys: 'Mod+=', scope: 'global' },
  { id: 'zoomOut', label: '缩小字号', category: '视图', defaultKeys: 'Mod+-', scope: 'global' },
  { id: 'zoomReset', label: '重置字号', category: '视图', defaultKeys: 'Mod+0', scope: 'global' },
  { id: 'help', label: 'Kiny 语法参考', category: '帮助', defaultKeys: 'F1', scope: 'global' },
]

const BY_ID = new Map<CommandId, CommandDef>(COMMANDS.map((c) => [c.id, c]))

export function getCommand(id: CommandId): CommandDef {
  const c = BY_ID.get(id)
  if (!c) throw new Error('未知命令：' + id)
  return c
}

/** 可重绑命令（非 readonly）。 */
export function rebindableCommands(): CommandDef[] {
  return COMMANDS.filter((c) => !c.readonly)
}

/** 命令 id 是否可重绑。 */
export function isRebindable(id: CommandId): boolean {
  return !getCommand(id).readonly
}
