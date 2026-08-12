import { useState } from 'react'
import type { ShortcutOverrides } from '../state/settings'
import { effectiveKeys } from '../shortcuts/bindings'
import { format, isMac } from '../shortcuts/keys'
import type { CommandId } from '../shortcuts/registry'
import { type PresetId, PRESET_IDS, PRESET_LABEL } from '../state/themes'

type EditCmd = 'cut' | 'copy' | 'paste' | 'selectAll'
type ViewKey = 'sidebar' | 'preview' | 'highlight' | 'ai'

export interface MenuBarProps {
  projectName: string | null
  anyDirty: boolean
  errorCount: number
  warnCount: number
  hasProgram: boolean
  canSave: boolean
  /** 有效明暗基底（用于非主题判断处，如启动页 banner）。 */
  theme: 'dark' | 'light'
  /** 活动主题标识：用于主题菜单打勾（区分象牙稿 vs 素雪白，二者明暗性质都是 light）。 */
  activeThemeId: string
  view: { sidebar: boolean; preview: boolean; highlight: boolean; ai: boolean }
  onNewProject: () => void
  onOpenProject: () => void
  onNewFile: () => void
  onSave: () => void
  onSaveAll: () => void
  onExportKip: () => void
  onExportWebpage: () => void
  /** 导出线性文稿（format 'md' | 'txt'）。 */
  onExportManuscript: (format: 'md' | 'txt') => void
  /** 打开项目级搜索面板。 */
  onSearchInFiles: () => void
  /** 对光标所在节点发起重命名。 */
  onRenameNode: () => void
  onExit: () => void
  onEdit: (cmd: EditCmd) => void
  onSetTheme: (t: PresetId) => void
  onToggleView: (key: ViewKey) => void
  onSyntaxRef: () => void
  /** 打开「作品主题参考」（css token / class 契约 / 字体用法）。 */
  onThemeRef: () => void
  onAbout: () => void
  onReportIssue: () => void
  onOpenSettings: () => void
  onOpenProjectSettings: () => void
  /** 打开作品主题文件：有 `theme.css` 就开它，没有则按模板建一个再开（存量项目的路）。 */
  onOpenTheme: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  /** 快捷键自定义覆盖：菜单 sc 提示由注册表生效绑定派生，与真实绑定同源、不漂移。 */
  shortcuts: ShortcutOverrides
  /** 是否已存过「我的布局」快照——决定「恢复我的布局」是否渲染。 */
  hasSavedLayout: boolean
  onSaveLayout: () => void
  onRestoreMyLayout: () => void
  onRestoreDefaultLayout: () => void
  /** 最近项目（按最近打开降序）；供「最近打开」子菜单。 */
  recentProjects: { dir: string; name: string }[]
  onOpenRecent: (dir: string) => void
  onCloseProject: () => void
  /** 外部控制运行态（T040）：非 null 时常驻显示「已启用 · 端口 N」，提醒作者本机端口开着。 */
  controlInfo: { port: number } | null
}

interface Item {
  label?: string
  sc?: string
  disabled?: boolean
  check?: boolean
  sep?: boolean
  act?: () => void
  /** 子菜单项（如「最近打开」）；有则悬停展开、本项自身不触发 act。 */
  sub?: { label: string; act: () => void }[]
}

// 「最近打开」子菜单最多列几条（LRU 存储已封顶 20，这里再截给菜单）。
const RECENT_MENU_MAX = 8

export function MenuBar(p: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null)

  // sc 提示统一取自注册表生效绑定（覆盖 ?? 默认），与全局 keydown / CM 绑定同源。
  const eff = effectiveKeys(p.shortcuts)
  const mac = isMac()
  const scFor = (id: CommandId) => format(eff.get(id)!, mac)

  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: 'file',
      label: '文件',
      items: [
        { label: '新建项目...', sc: scFor('newProject'), act: p.onNewProject },
        { label: '打开项目...', sc: scFor('openProject'), act: p.onOpenProject },
        { label: '新建文件...', sc: scFor('newFile'), act: p.onNewFile },
        p.recentProjects.length > 0
          ? { label: '最近打开', sub: p.recentProjects.slice(0, RECENT_MENU_MAX).map((r) => ({ label: r.name, act: () => p.onOpenRecent(r.dir) })) }
          : { label: '最近打开', disabled: true },
        { sep: true },
        { label: '保存', sc: scFor('save'), disabled: !p.canSave, act: p.onSave },
        { label: '全部保存', sc: scFor('saveAll'), disabled: !p.anyDirty, act: p.onSaveAll },
        { sep: true },
        { label: '关闭项目', disabled: !p.projectName, act: p.onCloseProject },
        { label: '项目设置...', disabled: !p.projectName, act: p.onOpenProjectSettings },
        { label: '作品主题...', disabled: !p.projectName, act: p.onOpenTheme },
        { label: '导出故事包（.kip）...', disabled: !p.projectName || p.errorCount > 0, act: p.onExportKip },
        { label: '导出独立网页...', disabled: !p.projectName || p.errorCount > 0, act: p.onExportWebpage },
        {
          label: '导出线性文稿',
          disabled: !p.projectName,
          sub: [
            { label: 'Markdown (.md)', act: () => p.onExportManuscript('md') },
            { label: '纯文本 (.txt)', act: () => p.onExportManuscript('txt') },
          ],
        },
        { sep: true },
        { label: '退出', sc: 'Alt+F4', act: p.onExit },
      ],
    },
    {
      id: 'edit',
      label: '编辑',
      items: [
        { label: '撤销', sc: scFor('undo'), disabled: true },
        { label: '重做', sc: scFor('redo'), disabled: true },
        { sep: true },
        { label: '剪切', sc: scFor('cut'), act: () => p.onEdit('cut') },
        { label: '复制', sc: scFor('copy'), act: () => p.onEdit('copy') },
        { label: '粘贴', sc: scFor('paste'), act: () => p.onEdit('paste') },
        { label: '全选', sc: scFor('selectAll'), act: () => p.onEdit('selectAll') },
        { sep: true },
        { label: '查找...', sc: 'Ctrl+F', disabled: true },
        { label: '在文件中搜索...', sc: scFor('searchInFiles'), disabled: !p.projectName, act: p.onSearchInFiles },
        { label: '重命名节点...', sc: scFor('renameNode'), disabled: !p.projectName, act: p.onRenameNode },
        { label: '跳转到节点...', sc: 'Ctrl+P', disabled: true },
      ],
    },
    {
      id: 'view',
      label: '视图',
      items: [
        { label: '设置...', sc: scFor('openSettings'), act: p.onOpenSettings },
        { sep: true },
        ...PRESET_IDS.map((id) => ({ label: `主题：${PRESET_LABEL[id]}`, check: p.activeThemeId === id, act: () => p.onSetTheme(id) })),
        { sep: true },
        { label: '节点导航 / 资源管理器', check: p.view.sidebar, act: () => p.onToggleView('sidebar') },
        { label: '预览 / 结构图面板', check: p.view.preview, act: () => p.onToggleView('preview') },
        { label: '语义着色', check: p.view.highlight, act: () => p.onToggleView('highlight') },
        { label: 'AI 面板', check: p.view.ai, act: () => p.onToggleView('ai') },
        { sep: true },
        { label: '放大', sc: scFor('zoomIn'), act: p.onZoomIn },
        { label: '缩小', sc: scFor('zoomOut'), act: p.onZoomOut },
        { label: '重置字号', sc: scFor('zoomReset'), act: p.onZoomReset },
        { sep: true },
        { label: '保存当前布局', act: p.onSaveLayout },
        // 未存过快照时整项不渲染（隐藏而非置灰，消除无法点的死项）。
        ...(p.hasSavedLayout ? [{ label: '恢复我的布局', act: p.onRestoreMyLayout }] : []),
        { label: '恢复默认布局', act: p.onRestoreDefaultLayout },
      ],
    },
    {
      id: 'help',
      label: '帮助',
      items: [
        { label: 'Kiny 语法参考', sc: scFor('help'), act: p.onSyntaxRef },
        { label: '作品主题参考', act: p.onThemeRef },
        { sep: true },
        { label: '问题反馈...', act: p.onReportIssue },
        { sep: true },
        { label: '关于 Kiny Editor', act: p.onAbout },
      ],
    },
  ]

  return (
    <div className="menubar" role="menubar">
      {open !== null && <div className="menu-scrim" onClick={() => setOpen(null)} />}
      {menus.map((m) => (
        <div key={m.id} className="menu-root">
          <button
            className={'menu-title' + (open === m.id ? ' open' : '')}
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === m.id}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onMouseEnter={() => open !== null && setOpen(m.id)}
          >
            {m.label}
          </button>
          {open === m.id && (
            <div className="menu-dropdown" role="menu">
              {m.items.map((it, i) =>
                it.sep ? (
                  <div className="menu-sep" key={i} />
                ) : it.sub ? (
                  <SubMenuItem key={i} item={it} onPick={() => setOpen(null)} />
                ) : (
                  <button
                    key={i}
                    className={'menu-item' + (it.disabled ? ' disabled' : '')}
                    role="menuitem"
                    aria-disabled={it.disabled ? 'true' : undefined}
                    onClick={() => {
                      if (it.disabled) return
                      it.act?.()
                      setOpen(null)
                    }}
                  >
                    <span className="menu-check" aria-hidden={true}>{it.check ? '✓' : ''}</span>
                    <span className="menu-label">{it.label}</span>
                    {it.sc && <span className="menu-sc" aria-hidden={true}>{it.sc}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}

      <span className="menubar-right">
        {p.controlInfo !== null && (
          <span className="status-pill control-on" title="本机 HTTP 服务已开放给外部控制（CLI/skill），可在设置 → AI 中关闭">
            外部控制已启用 · 端口 {p.controlInfo.port}
          </span>
        )}
        <span className="menubar-project">{projectNameView(p.projectName)}</span>
        {p.anyDirty && <span className="menubar-dirty">● 未保存</span>}
        {p.projectName && statusPill(p)}
      </span>
    </div>
  )
}

/** 带子菜单的菜单项（如「最近打开」）：悬停 / 聚焦展开右侧子面板，点子项触发并关整菜单。 */
function SubMenuItem({ item, onPick }: { item: Item; onPick: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const sub = item.sub ?? []
  return (
    <div
      className="menu-sub-root"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <button
        className="menu-item"
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="menu-check" aria-hidden={true} />
        <span className="menu-label">{item.label}</span>
        <span className="menu-sub-arrow" aria-hidden={true}>▸</span>
      </button>
      {expanded && (
        <div className="menu-dropdown menu-submenu" role="menu">
          {sub.map((s, i) => (
            <button
              key={i}
              className="menu-item"
              role="menuitem"
              onClick={() => { s.act(); onPick() }}
            >
              <span className="menu-check" aria-hidden={true} />
              <span className="menu-label">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function projectNameView(name: string | null) {
  return name ?? '未打开项目'
}

function statusPill(p: MenuBarProps) {
  if (p.errorCount > 0) return <span className="status-pill bad">{p.errorCount} 处错误</span>
  if (p.warnCount > 0) return <span className="status-pill warn">{p.warnCount} 处提示</span>
  if (p.hasProgram) return <span className="status-pill ok">校验通过</span>
  return null
}
