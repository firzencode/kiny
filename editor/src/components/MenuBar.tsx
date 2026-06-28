import { useState } from 'react'

type EditCmd = 'cut' | 'copy' | 'paste' | 'selectAll'
type ViewKey = 'sidebar' | 'preview' | 'highlight' | 'ai'

export interface MenuBarProps {
  projectName: string | null
  anyDirty: boolean
  errorCount: number
  warnCount: number
  hasProgram: boolean
  canSave: boolean
  theme: 'dark' | 'light'
  view: { sidebar: boolean; preview: boolean; highlight: boolean; ai: boolean }
  onNewProject: () => void
  onOpenProject: () => void
  onNewFile: () => void
  onSave: () => void
  onSaveAll: () => void
  onExportKip: () => void
  onExportWebpage: () => void
  onExit: () => void
  onEdit: (cmd: EditCmd) => void
  onSetTheme: (t: 'dark' | 'light') => void
  onToggleView: (key: ViewKey) => void
  onSyntaxRef: () => void
  onAbout: () => void
  onReportIssue: () => void
  onOpenSettings: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

interface Item {
  label?: string
  sc?: string
  disabled?: boolean
  check?: boolean
  sep?: boolean
  act?: () => void
}

export function MenuBar(p: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null)

  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: 'file',
      label: '文件',
      items: [
        { label: '新建项目...', sc: 'Ctrl+N', act: p.onNewProject },
        { label: '打开项目...', sc: 'Ctrl+O', act: p.onOpenProject },
        { label: '新建文件...', sc: 'Ctrl+Shift+N', act: p.onNewFile },
        { label: '最近打开', disabled: true },
        { sep: true },
        { label: '保存', sc: 'Ctrl+S', disabled: !p.canSave, act: p.onSave },
        { label: '全部保存', sc: 'Ctrl+Alt+S', disabled: !p.anyDirty, act: p.onSaveAll },
        { sep: true },
        { label: '导出故事包（.kip）...', disabled: !p.projectName || p.errorCount > 0, act: p.onExportKip },
        { label: '导出独立网页...', disabled: !p.projectName || p.errorCount > 0, act: p.onExportWebpage },
        { sep: true },
        { label: '退出', sc: 'Alt+F4', act: p.onExit },
      ],
    },
    {
      id: 'edit',
      label: '编辑',
      items: [
        { label: '撤销', sc: 'Ctrl+Z', disabled: true },
        { label: '重做', sc: 'Ctrl+Y', disabled: true },
        { sep: true },
        { label: '剪切', sc: 'Ctrl+X', act: () => p.onEdit('cut') },
        { label: '复制', sc: 'Ctrl+C', act: () => p.onEdit('copy') },
        { label: '粘贴', sc: 'Ctrl+V', act: () => p.onEdit('paste') },
        { label: '全选', sc: 'Ctrl+A', act: () => p.onEdit('selectAll') },
        { sep: true },
        { label: '查找...', sc: 'Ctrl+F', disabled: true },
        { label: '跳转到节点...', sc: 'Ctrl+P', disabled: true },
      ],
    },
    {
      id: 'view',
      label: '视图',
      items: [
        { label: '设置...', sc: 'Ctrl+,', act: p.onOpenSettings },
        { sep: true },
        { label: '主题：石板墨', check: p.theme === 'dark', act: () => p.onSetTheme('dark') },
        { label: '主题：象牙稿', check: p.theme === 'light', act: () => p.onSetTheme('light') },
        { sep: true },
        { label: '节点导航 / 资源管理器', check: p.view.sidebar, act: () => p.onToggleView('sidebar') },
        { label: '预览面板', check: p.view.preview, act: () => p.onToggleView('preview') },
        { label: '语义着色', check: p.view.highlight, act: () => p.onToggleView('highlight') },
        { label: 'AI 面板', check: p.view.ai, act: () => p.onToggleView('ai') },
        { sep: true },
        { label: '放大', sc: 'Ctrl+=', act: p.onZoomIn },
        { label: '缩小', sc: 'Ctrl+-', act: p.onZoomOut },
        { label: '重置字号', sc: 'Ctrl+0', act: p.onZoomReset },
      ],
    },
    {
      id: 'help',
      label: '帮助',
      items: [
        { label: 'Kiny 语法参考', sc: 'Ctrl+/', act: p.onSyntaxRef },
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
        <span className="menubar-project">{projectNameView(p.projectName)}</span>
        {p.anyDirty && <span className="menubar-dirty">● 未保存</span>}
        {p.projectName && statusPill(p)}
      </span>
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
