import { useState } from 'react'
import { buildTree, collectDirs, moveTarget, type TreeNode } from '../files/tree'
import { resolveImportDir } from '../files/importAssets'
import { isTextFile, type ProjectFileEntry } from '../files/gateway'
import { mediaKind } from '../files/media'

const FileIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" />
  </svg>
)

interface CtxMenu {
  path: string
  kind: 'file' | 'dir' | 'root'
  x: number
  y: number
}

export function Explorer({
  projectName, entries, emptyDirs, dirtyMap, conflictMap = {}, activeFile, entry,
  onOpenFile, onCreateFile, newFileFocusToken,
  onRename, onDelete, onCreateFolder, onMove, onImportAssets,
  collapsed, onToggleCollapse, style,
}: {
  projectName: string | null
  entries: ProjectFileEntry[]
  emptyDirs: string[]
  dirtyMap: Record<string, boolean>
  /** 冲突 / 删除标记（conflict 或 missing 均记 true）；命中时覆盖显示，优先级高于 dirty 圆点。缺省空表（既有调用方不受影响）。 */
  conflictMap?: Record<string, boolean>
  activeFile: string | null
  entry: string | null
  onOpenFile: (path: string) => void
  onCreateFile: (rawPath: string) => void
  newFileFocusToken?: number
  onRename: (from: string, to: string) => void
  onDelete: (path: string) => void
  onCreateFolder: (path: string) => void
  onMove: (from: string, toDir: string) => void
  /** 导入资源到 targetDir（项目根相对，'' = 根）。 */
  onImportAssets: (targetDir: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  style?: React.CSSProperties
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  // 「移动到…」点击式选择器：打开时取右键菜单坐标定位（position:fixed），复用 ctx-menu 样式。
  const [movePicker, setMovePicker] = useState<{ from: string; x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  // Rename state
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // New folder inline state: which folder is getting a new subfolder
  const [creatingFolderUnder, setCreatingFolderUnder] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')

  const [lastToken, setLastToken] = useState(newFileFocusToken)
  if (newFileFocusToken !== lastToken) {
    setLastToken(newFileFocusToken)
    if (!creating) { setRenaming(null); setRenameValue(''); setCreatingFolderUnder(null); setFolderName(''); setCreating(true) }
  }

  const closeCtx = () => setCtxMenu(null)

  const tryMove = (from: string, toDir: string) => {
    const to = moveTarget(from, toDir)
    if (to !== null) onMove(from, toDir)
  }

  // Clear all inline-input modes; each entry point calls this then sets its own mode.
  const resetInlineModes = () => {
    setRenaming(null); setRenameValue('')
    setCreatingFolderUnder(null); setFolderName('')
    setCreating(false); setName('')
  }

  const submit = () => {
    const v = name.trim(); setCreating(false); setName('')
    if (v !== '') onCreateFile(v)
  }

  const submitRename = () => {
    const v = renameValue.trim()
    const old = renaming
    setRenaming(null)
    setRenameValue('')
    if (old && v !== '') {
      const dir = old.includes('/') ? old.slice(0, old.lastIndexOf('/') + 1) : ''
      const to = dir + v
      if (to !== old) onRename(old, to)
    }
  }

  const cancelRename = () => {
    setRenaming(null)
    setRenameValue('')
  }

  const submitNewFolder = () => {
    const v = folderName.trim()
    if (creatingFolderUnder !== null && v !== '') {
      const fullPath = creatingFolderUnder ? `${creatingFolderUnder}/${v}` : v
      onCreateFolder(fullPath)
    }
    setCreatingFolderUnder(null)
    setFolderName('')
  }

  const cancelNewFolder = () => {
    setCreatingFolderUnder(null)
    setFolderName('')
  }

  const handleCtxMenu = (e: React.MouseEvent, path: string, kind: 'file' | 'dir') => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ path, kind, x: e.clientX, y: e.clientY })
  }

  const tree = buildTree(entries.map((e) => ({ path: e.path, isKin: e.isKin })), emptyDirs)

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const pad = { paddingLeft: `${8 + depth * 12}px` } as React.CSSProperties
    if (n.kind === 'dir') {
      const open = expanded[n.path] === true
      const isCreatingSubfolder = creatingFolderUnder === n.path
      return (
        <li key={n.path}>
          <div
            className="frow afolder"
            style={pad}
            onClick={() => setExpanded((e) => ({ ...e, [n.path]: !open }))}
            onContextMenu={(e) => handleCtxMenu(e, n.path, 'dir')}
          >
            <span className="afolder-chev">{open ? '▾' : '▸'}</span>{n.name}
          </div>
          {open && (
            <ul className="explorer-list">
              {n.children!.map((c) => renderNode(c, depth + 1))}
              {isCreatingSubfolder && (
                <li className="frow frow-new" style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}>
                  <input
                    className="frow-input"
                    autoFocus
                    placeholder="文件夹名..."
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return // 输入法组合中，忽略
                      if (e.key === 'Enter') submitNewFolder()
                      if (e.key === 'Escape') cancelNewFolder()
                    }}
                    onBlur={cancelNewFolder}
                  />
                </li>
              )}
            </ul>
          )}
        </li>
      )
    }
    // File row
    const isRenaming = renaming === n.path
    // 点得开的文件：可编辑的文本（.kin + 作品前端资源 css/js/json/txt/md/html）与
    // 有查看器的媒体（图片 / 音频）。字体等其余二进制灰显只列名。
    const openable = isTextFile(n.path) || mediaKind(n.path) !== null
    return (
      <li
        key={n.path}
        className={'frow' + (n.path === activeFile ? ' active' : '') + (openable ? '' : ' frow-other')}
        style={pad}
        onClick={() => { if (!isRenaming && openable) onOpenFile(n.path) }}
        onContextMenu={(e) => handleCtxMenu(e, n.path, 'file')}
      >
        <span className="frow-icon"><FileIcon /></span>
        {isRenaming ? (
          <input
            className="frow-input"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return // 输入法组合中，忽略
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') cancelRename()
            }}
            onBlur={cancelRename}
          />
        ) : (
          <>
            <span className="frow-name">{n.name}</span>
            {n.path === entry && <span className="frow-entry" aria-label="入口文件">⌂</span>}
            {conflictMap[n.path] ? <span className="frow-conflict" aria-hidden /> : dirtyMap[n.path] && <span className="frow-dirty" aria-hidden />}
          </>
        )}
      </li>
    )
  }

  return (
    <nav className={'explorer' + (collapsed ? ' collapsed' : '')} style={style} aria-label="资源管理器">
      {/* Context menu backdrop + menu */}
      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onClick={closeCtx} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <ul
            className="ctx-menu"
            style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 100 }}
            onClick={(e) => e.stopPropagation()}
          >
            {ctxMenu.kind !== 'root' && (
              <>
                <li onClick={() => {
                  const path = ctxMenu.path
                  closeCtx()
                  resetInlineModes()
                  const fileName = path.slice(path.lastIndexOf('/') + 1)
                  setRenaming(path)
                  setRenameValue(fileName)
                }}>重命名</li>
                <li onClick={() => {
                  const { path, x, y } = ctxMenu
                  closeCtx()
                  resetInlineModes()
                  setMovePicker({ from: path, x, y })
                }}>移动到…</li>
                <li onClick={() => {
                  const path = ctxMenu.path
                  closeCtx()
                  onDelete(path)
                }}>删除</li>
              </>
            )}
            {ctxMenu.kind !== 'file' && (
              <>
                <li onClick={() => {
                  const path = ctxMenu.path
                  closeCtx()
                  resetInlineModes()
                  // Expand the folder so the inline input appears under it（根目录 path 为 '' 时落在根列表末尾）
                  if (path) setExpanded((e) => ({ ...e, [path]: true }))
                  setCreatingFolderUnder(path)
                }}>新建文件夹</li>
                <li onClick={() => {
                  const path = ctxMenu.path
                  closeCtx()
                  resetInlineModes()
                  // Pre-seed the new-file input with the folder prefix（根目录则为空）
                  setCreating(true)
                  setName(path ? `${path}/` : '')
                }}>新建文件</li>
              </>
            )}
            <li onClick={() => {
              const target = resolveImportDir(ctxMenu.kind, ctxMenu.path)
              closeCtx()
              onImportAssets(target)
            }}>导入资源…</li>
          </ul>
        </>
      )}

      {/* 「移动到…」选择器：候选 = 根目录 + 全部文件夹，经 moveTarget 过滤（排除自身/子孙/原位）。 */}
      {movePicker && (() => {
        const candidates = [{ path: '', name: '根目录', depth: 0 }, ...collectDirs(tree).map((d) => ({ ...d, depth: d.depth + 1 }))]
          .filter((c) => moveTarget(movePicker.from, c.path) !== null)
        return (
          <>
            <div className="ctx-backdrop" onClick={() => setMovePicker(null)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
            <ul
              className="ctx-menu move-picker"
              style={{ position: 'fixed', left: movePicker.x, top: movePicker.y, zIndex: 100 }}
              onClick={(e) => e.stopPropagation()}
            >
              {candidates.length === 0 ? (
                <li className="ctx-disabled" aria-disabled>无可移动到的位置</li>
              ) : (
                candidates.map((c) => (
                  <li
                    key={c.path || '<root>'}
                    style={{ paddingLeft: `${10 + c.depth * 12}px` }}
                    onClick={() => { tryMove(movePicker.from, c.path); setMovePicker(null) }}
                  >{c.name}</li>
                ))
              )}
            </ul>
          </>
        )
      })()}

      <div className="explorer-head">
        <button
          className={'collapse-btn' + (collapsed ? ' collapsed' : '')}
          aria-label={collapsed ? '展开资源管理器' : '折叠资源管理器'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <span className="explorer-title">资源管理器</span>
      </div>
      {!collapsed && <div className="explorer-proj">{projectName ?? '未打开项目'}</div>}
      <ul
        className="explorer-list"
        onContextMenu={(e) => {
          e.preventDefault()
          setCtxMenu({ path: '', kind: 'root', x: e.clientX, y: e.clientY })
        }}
      >
        {tree.map((n) => renderNode(n, 0))}
        {creating && (
          <li className="frow frow-new">
            <span className="frow-icon"><FileIcon /></span>
            <input className="frow-input" autoFocus placeholder="文件名（可含子目录）..."
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return // 输入法组合中，忽略
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') { setCreating(false); setName('') }
              }}
              onBlur={() => { setCreating(false); setName('') }} />
          </li>
        )}
        {creatingFolderUnder === '' && (
          <li className="frow frow-new">
            <input className="frow-input" autoFocus placeholder="文件夹名..."
              value={folderName} onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return // 输入法组合中，忽略
                if (e.key === 'Enter') submitNewFolder()
                if (e.key === 'Escape') cancelNewFolder()
              }}
              onBlur={cancelNewFolder} />
          </li>
        )}
      </ul>
    </nav>
  )
}
