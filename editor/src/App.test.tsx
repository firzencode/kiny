import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { App } from './App'
import { createMemoryGateway } from './files/memoryGateway'
import { SESSION_KEY } from './state/session'
import { SETTINGS_KEY } from './state/settings'

// 编辑区已是 CodeMirror 6（contenteditable，非 textarea）。这些 helper 经内部 EditorView
// 读文档 / 模拟用户编辑（dispatch 事务，走 updateListener→onChange→React，等价真实输入）。
function cmView(): EditorView {
  const el = document.querySelector('.cm-editor') as HTMLElement | null
  const view = el && EditorView.findFromDOM(el)
  if (!view) throw new Error('未找到 EditorView')
  return view
}
function editorValue(): string {
  return cmView().state.doc.toString()
}
async function typeInEditor(text: string, atEnd = false) {
  const view = cmView()
  await act(async () => {
    if (atEnd) view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) })
    view.dispatch(view.state.replaceSelection(text))
  })
}

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  localStorage.clear() // 隔离会话持久化，避免跨测试污染
})

const MAIN = `开场。
* [向左] -> 左
* [向右] -> 右
=== 左 ===
你往左走。
-> END
`
const END = `=== 右 ===
你往右走。
-> END
`
function gw(files: Record<string, string> = { '/proj/main.kin': MAIN, '/proj/末.kin': END }) {
  return createMemoryGateway({
    pickedDir: '/proj',
    newDir: '/fresh',
    files: { '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }), ...files },
  })
}

function gwExport(over: { saveKipPath?: string | null; exportSink?: { dest: string; files: string[] }[]; confirmResult?: boolean } = {}) {
  return createMemoryGateway({
    pickedDir: '/proj',
    newDir: '/fresh',
    files: { '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }), '/proj/main.kin': MAIN, '/proj/末.kin': END },
    saveKipPath: 'saveKipPath' in over ? over.saveKipPath : '/out/雾港.kip',
    exportSink: over.exportSink,
    confirmResult: over.confirmResult,
  })
}

// 经菜单「文件 → <item>」点击
async function fileMenu(item: string) {
  await userEvent.click(screen.getByRole('menuitem', { name: '文件' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

describe('App 多文件集成', () => {
  it('打开项目 → 菜单栏显示项目名、只开入口 tab、资源管理器列出全部文件、预览推进到首选项', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0)
    // 资源管理器列出两个文件（文件名同时出现在 explorer + tabbar，用 findAllByText）
    expect((await screen.findAllByText('main.kin')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('末.kin').length).toBeGreaterThan(0)
    // 只开入口 tab：编辑区 textarea 是 main.kin 内容
    expect(editorValue()).toContain('开场。')
    // 预览推进到首个选项
    expect(await screen.findByRole('button', { name: '向左' })).toBeInTheDocument()
  })

  it('OS 双击 .kiw 打开事件：派生父目录并打开该项目', async () => {
    const hook: { fire?: (path: string) => void } = {}
    const gateway = createMemoryGateway({
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/末.kin': END,
      },
      openFileHook: hook,
    })
    render(<App gateway={gateway} />)
    await waitFor(() => expect(hook.fire).toBeDefined()) // onOpenProjectFile 订阅已建立
    hook.fire!('/proj/雾港.kiw') // 派生父目录 = /proj
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('main.kin')).length).toBeGreaterThan(0)
  })

  it('冷启动（OS 双击 .kiw 首次拉起）：mount 后取走启动路径并打开该项目', async () => {
    const gateway = createMemoryGateway({
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/末.kin': END,
      },
      launchProject: '/proj/雾港.kiw', // Rust 暂存的冷启动路径，派生父目录 = /proj
    })
    render(<App gateway={gateway} />)
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('main.kin')).length).toBeGreaterThan(0)
  })

  it('会话恢复：预置该项目上次活动 tab 为 末.kin → 打开项目后编辑区即是 末.kin', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1,
      projects: { '/proj': { openTabs: ['main.kin', '末.kin'], activeFile: '末.kin', ts: 1 } },
    }))
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await waitFor(() => expect(editorValue()).toContain('你往右走。'))
  })

  it('会话保存：打开项目后把当前会话写入 localStorage', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await waitFor(() => {
      const store = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}')
      expect(store.projects?.['/proj']?.activeFile).toBe('main.kin')
    })
  })

  it('点资源管理器里的文件 → 开新 tab、编辑区切到该文件', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText('末.kin'))
    await waitFor(() => expect(editorValue()).toContain('你往右走。'))
  })

  it('编辑 → 跨文件校验出诊断（在另一个文件造语法错）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    // 打开 末.kin 并改成无目标 divert
    const explorer2 = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer2).getByText('末.kin'))
    await waitFor(() => expect(editorValue()).toContain('你往右走。')) // 等切到 末.kin
    await typeInEditor('\n-> ', true) // 末尾追加无目标 divert
    // 防抖落地后诊断出现，且 file 指向 末.kin
    await screen.findByText((_, el) => el?.classList.contains('diagnostic-error') ?? false)
    expect(document.querySelectorAll('.diagnostic-error').length).toBeGreaterThan(0)
  })

  it('点跨文件诊断 → 打开对应文件 tab 并聚焦编辑区', async () => {
    // 错误在 末.kin（无目标 divert），活动文件是入口 main.kin → 点诊断应切到 末.kin tab
    render(<App gateway={gw({ '/proj/main.kin': MAIN, '/proj/末.kin': '=== 右 ===\n-> ' })} />)
    await fileMenu('打开项目...')
    const item = await screen.findByText((_, el) => el?.classList.contains('diagnostic-error') ?? false)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.click(item)
    // 切到 末.kin：编辑区显示其内容并聚焦
    await waitFor(() => expect(editorValue()).toContain('=== 右 ==='))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')))
  })

  it('点同文件诊断 → 聚焦编辑区（跳行）', async () => {
    // 错误在活动文件 main.kin 自身 → 点诊断不切 tab，直接落光标并聚焦编辑区
    render(<App gateway={gw({ '/proj/main.kin': '开场。\n-> \n', '/proj/末.kin': END })} />)
    await fileMenu('打开项目...')
    const item = await screen.findByText((_, el) => el?.classList.contains('diagnostic-error') ?? false)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.click(item)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')))
  })

  it('改文本 → 保存（文件菜单）→ dirty 清除、gateway 收到写回', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    expect(screen.getByText('● 未保存')).toBeInTheDocument()
    await fileMenu('保存')
    await waitFor(() => expect(writeSpy).toHaveBeenCalled())
    expect(writeSpy.mock.calls[0]![0]).toBe('/proj')
    expect(writeSpy.mock.calls[0]![1]).toBe('main.kin')
    await waitFor(() => expect(screen.queryByText('● 未保存')).toBeNull())
  })

  it('改文本 → Ctrl+S 快捷键保存 → dirty 清除、gateway 收到写回', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    expect(screen.getByText('● 未保存')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(writeSpy).toHaveBeenCalledWith('/proj', 'main.kin', expect.any(String)))
    await waitFor(() => expect(screen.queryByText('● 未保存')).toBeNull())
  })

  it('Ctrl+O 快捷键打开项目', async () => {
    render(<App gateway={gw()} />)
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0)
  })

  it('Ctrl+N 快捷键新建项目', async () => {
    const gateway = gw()
    const newSpy = vi.spyOn(gateway, 'newProject')
    render(<App gateway={gateway} />)
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    await waitFor(() => expect(newSpy).toHaveBeenCalled())
  })

  it('Ctrl+Shift+N 快捷键新建文件（出现内联输入）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true })
    expect(await screen.findByPlaceholderText('文件名（可含子目录）...')).toBeInTheDocument()
  })

  it('新建文件 → 落盘、开 tab、出现在资源管理器', async () => {
    const gateway = gw()
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('新建文件...')
    await userEvent.type(screen.getByPlaceholderText('文件名（可含子目录）...'), '盘问{Enter}')
    expect((await screen.findAllByText('盘问.kin')).length).toBeGreaterThan(0)
    await waitFor(() => expect(editorValue()).toContain('=== 新节点 ==='))
  })

  it('预览里点选项 → 叙事增长（保位）；切 tab 不影响预览', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    const preview = screen.getByTestId('preview')
    await userEvent.click(await screen.findByRole('button', { name: '向左' }))
    expect(await within(preview).findByText('你往左走。')).toBeInTheDocument()
    expect(within(preview).getByText('开场。')).toBeInTheDocument()
  })

  it('重开预览 → 重置回开场选项', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    const preview = screen.getByTestId('preview')
    await userEvent.click(await screen.findByRole('button', { name: '向左' }))
    expect(await within(preview).findByText('你往左走。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '↺ 重开预览' }))
    expect(await screen.findByRole('button', { name: '向左' })).toBeInTheDocument()
    expect(within(preview).queryByText('你往左走。')).toBeNull()
  })

  it('打开 IO 失败 → role=alert 通知、项目名不载入', async () => {
    const gateway = gw()
    vi.spyOn(gateway, 'readProject').mockRejectedValue(new Error('读盘炸了'))
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    expect(await screen.findByRole('alert')).toHaveTextContent('读盘炸了')
    expect(screen.queryByText('雾港')).toBeNull()
  })

  it('新建项目 → 脚手架载入、菜单栏显示起始项目名', async () => {
    const gateway = createMemoryGateway({ newDir: '/fresh', files: {} })
    render(<App gateway={gateway} />)
    await fileMenu('新建项目...')
    expect((await screen.findAllByText('未命名项目')).length).toBeGreaterThan(0)
    expect(editorValue()).toContain('=== 开场 ===')
  })

  it('打开含子目录的项目 → 树展开后可打开子目录 .kin', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== 开场 ===\n-> 子节点\n',
        '/proj/chapters/c.kin': '=== 子节点 ===\n结束。\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    // 展开 chapters 文件夹后点 c.kin（资源管理器内）
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText('chapters'))
    await userEvent.click(within(explorer).getByText('c.kin'))
    // c.kin 进入编辑区（其首节点名出现在大纲/编辑区），且无错误诊断
    expect(within(explorer).getByText('c.kin')).toBeInTheDocument()
    await waitFor(() =>
      expect(editorValue()).toContain('子节点'),
    )
  })

  it('删除文件：确认通过 → 文件消失', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj', confirmResult: true,
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== a ===\n-> END\n', '/proj/extra.kin': '=== b ===\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    fireEvent.contextMenu(within(explorer).getByText('extra.kin'))
    await userEvent.click(screen.getByText('删除'))
    await waitFor(() => expect(within(explorer).queryByText('extra.kin')).not.toBeInTheDocument())
  })

  it('删除入口文件被拦截（通知）', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj', confirmResult: true,
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== a ===\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    fireEvent.contextMenu(within(explorer).getByText('main.kin'))
    await userEvent.click(screen.getByText('删除'))
    await screen.findByText('入口文件不可删除')
    expect(within(explorer).getByText('main.kin')).toBeInTheDocument()
  })

  it('删除文件：确认取消 → 文件保留', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj', confirmResult: false,
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== a ===\n-> END\n', '/proj/extra.kin': '=== b ===\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    fireEvent.contextMenu(within(explorer).getByText('extra.kin'))
    await userEvent.click(screen.getByText('删除'))
    // 取消后文件仍在
    expect(within(explorer).getByText('extra.kin')).toBeInTheDocument()
  })

  it('改名入口文件：自动写回 kiny.json entry', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== a ===\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    fireEvent.contextMenu(within(explorer).getByText('main.kin'))
    await userEvent.click(screen.getByText('重命名'))
    const input = screen.getByDisplayValue('main.kin')
    await userEvent.clear(input)
    await userEvent.type(input, 'start.kin')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      const proj = await gateway.readProject('/proj')
      expect(proj.manifest.entry).toBe('start.kin')
    })
  })

  it('重命名失败 → 提示带动作前缀与具体报错信息', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== a ===\n-> END\n', '/proj/b.kin': '=== b ===\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    fireEvent.contextMenu(within(explorer).getByText('b.kin'))
    await userEvent.click(screen.getByText('重命名'))
    const input = screen.getByDisplayValue('b.kin')
    await userEvent.clear(input)
    await userEvent.type(input, 'main.kin') // 目标已存在
    fireEvent.keyDown(input, { key: 'Enter' })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('重命名失败')
    expect(alert).toHaveTextContent('目标已存在')
  })

  it('错误提示可点 × 关闭，再次出错重新出现', async () => {
    const gateway = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': '=== a ===\n-> END\n', '/proj/b.kin': '=== b ===\n-> END\n',
      },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = screen.getByRole('navigation', { name: '资源管理器' })
    const failRename = async () => {
      fireEvent.contextMenu(within(explorer).getByText('b.kin'))
      await userEvent.click(screen.getByText('重命名'))
      const input = screen.getByDisplayValue('b.kin')
      await userEvent.clear(input)
      await userEvent.type(input, 'main.kin')
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    await failRename()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await failRename()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('关闭有改动的 tab → 弹确认框，选保存 → 写回并关闭 tab', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await userEvent.click(screen.getByRole('button', { name: '关闭 main.kin' }))
    expect(await screen.findByRole('dialog', { name: '关闭未保存的文件' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(writeSpy).toHaveBeenCalledWith('/proj', 'main.kin', expect.any(String)))
    await waitFor(() => expect(screen.getByText('未打开文件')).toBeInTheDocument())
  })

  it('关闭有改动的 tab → 选不保存 → 关闭 tab 且不写回', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await userEvent.click(screen.getByRole('button', { name: '关闭 main.kin' }))
    await userEvent.click(await screen.findByRole('button', { name: '不保存' }))
    await waitFor(() => expect(screen.getByText('未打开文件')).toBeInTheDocument())
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('关闭有改动的 tab → 不保存 → 重新打开内容已回退到磁盘版本', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    const original = editorValue()
    await typeInEditor('ZZZ')
    await userEvent.click(screen.getByRole('button', { name: '关闭 main.kin' }))
    await userEvent.click(await screen.findByRole('button', { name: '不保存' }))
    await waitFor(() => expect(screen.getByText('未打开文件')).toBeInTheDocument())
    // 重新打开 main.kin：内容应回到磁盘版本，未保存的 ZZZ 不在
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText('main.kin'))
    await waitFor(() => expect(editorValue()).toBe(original))
    expect(editorValue()).not.toContain('ZZZ')
  })

  it('关闭有改动的 tab → 选取消 → tab 保留、改动仍在', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor('X')
    await userEvent.click(screen.getByRole('button', { name: '关闭 main.kin' }))
    await userEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(editorValue()).toContain('X')
    expect(screen.getByText('● 未保存')).toBeInTheDocument()
  })

  it('关闭无改动的 tab → 不弹框直接关闭', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await userEvent.click(screen.getByRole('button', { name: '关闭 main.kin' }))
    await waitFor(() => expect(screen.getByText('未打开文件')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('关闭非活动的脏 tab → 选保存 → 写回的是该 tab 的文件', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText('末.kin')) // 开并激活 末.kin
    await typeInEditor(' ')       // 改脏 末.kin
    const tabbar = screen.getByRole('tablist')
    await userEvent.click(within(tabbar).getByText('main.kin'))   // 切回 main.kin
    await userEvent.click(screen.getByRole('button', { name: '关闭 末.kin' }))
    await userEvent.click(await screen.findByRole('button', { name: '保存' }))
    await waitFor(() => expect(writeSpy).toHaveBeenCalledWith('/proj', '末.kin', expect.any(String)))
  })

  it('关 tab 选保存但写盘失败 → tab 不关 + 报错通知', async () => {
    const gateway = gw()
    vi.spyOn(gateway, 'writeFile').mockRejectedValue(new Error('磁盘炸了'))
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await userEvent.click(screen.getByRole('button', { name: '关闭 main.kin' }))
    await userEvent.click(await screen.findByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘炸了')
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByText('● 未保存')).toBeInTheDocument()
  })

  it('菜单退出 + 有未保存 → 弹退出确认框', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await fileMenu('退出')
    expect(await screen.findByRole('dialog', { name: '退出 Kiny Editor' })).toBeInTheDocument()
  })

  it('退出 → 全部保存 → 写回所有脏文件并关窗口', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    const closeSpy = vi.spyOn(gateway, 'closeWindow')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await fileMenu('退出')
    await userEvent.click(await screen.findByRole('button', { name: '全部保存' }))
    await waitFor(() => expect(writeSpy).toHaveBeenCalled())
    await waitFor(() => expect(closeSpy).toHaveBeenCalled())
  })

  it('退出 → 不保存并退出 → 关窗口且不写回', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeFile')
    const closeSpy = vi.spyOn(gateway, 'closeWindow')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await fileMenu('退出')
    await userEvent.click(await screen.findByRole('button', { name: '不保存并退出' }))
    await waitFor(() => expect(closeSpy).toHaveBeenCalled())
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('退出 → 取消 → 不关窗口、对话框消失', async () => {
    const gateway = gw()
    const closeSpy = vi.spyOn(gateway, 'closeWindow')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await fileMenu('退出')
    await userEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(closeSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('无未保存退出 → 不弹框直接关窗口', async () => {
    const gateway = gw()
    const closeSpy = vi.spyOn(gateway, 'closeWindow')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('退出')
    await waitFor(() => expect(closeSpy).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('退出 → 全部保存失败 → 不关窗口 + 报错', async () => {
    const gateway = gw()
    vi.spyOn(gateway, 'writeFile').mockRejectedValue(new Error('磁盘炸了'))
    const closeSpy = vi.spyOn(gateway, 'closeWindow')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor(' ')
    await fileMenu('退出')
    await userEvent.click(await screen.findByRole('button', { name: '全部保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘炸了')
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('关窗口失败 → 报错通知，不静默吞（回归：缺权限等导致 destroy 抛错）', async () => {
    const gateway = gw()
    vi.spyOn(gateway, 'closeWindow').mockRejectedValue(new Error('窗口关闭被拒'))
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('退出') // 无脏：直接 doExit → closeWindow 抛错
    expect(await screen.findByRole('alert')).toHaveTextContent('窗口关闭被拒')
  })
})

describe('App 设置弹窗', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme')
  })

  async function openSettings() {
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '设置...' }))
  }

  it('视图菜单「设置...」打开弹窗', async () => {
    render(<App gateway={gw()} />)
    await openSettings()
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument()
  })

  it('改代码字号 → 保存 → 写 CSS 变量 + localStorage', async () => {
    render(<App gateway={gw()} />)
    await openSettings()
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('14px')
    expect(JSON.parse(localStorage.getItem('kiny-editor-settings')!).codeSize).toBe(14)
  })

  it('改代码字号 → 取消 → CSS 变量与 localStorage 不变（仍是默认 13）', async () => {
    render(<App gateway={gw()} />)
    await openSettings()
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('13px')
    expect(JSON.parse(localStorage.getItem('kiny-editor-settings')!).codeSize).toBe(13)
  })

  it('Ctrl+, 打开设置', async () => {
    render(<App gateway={gw()} />)
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument()
  })

  it('Ctrl+= 即时放大代码字号 + 持久化（不经弹窗）', async () => {
    render(<App gateway={gw()} />)
    fireEvent.keyDown(window, { key: '=', ctrlKey: true })
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('14px')
    expect(JSON.parse(localStorage.getItem('kiny-editor-settings')!).codeSize).toBe(14)
  })

  it('Ctrl+0 重置代码字号回默认', async () => {
    render(<App gateway={gw()} />)
    fireEvent.keyDown(window, { key: '=', ctrlKey: true })
    fireEvent.keyDown(window, { key: '0', ctrlKey: true })
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('13px')
  })

  it('保存后重新挂载 → 从 localStorage 恢复字号', async () => {
    const { unmount } = render(<App gateway={gw()} />)
    await openSettings()
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    unmount()
    document.documentElement.removeAttribute('style')
    render(<App gateway={gw()} />)
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('14px')
  })

  it('设置弹窗打开时 Ctrl+= 不修改已提交的 settings（commit-model 守卫）', async () => {
    render(<App gateway={gw()} />)
    await openSettings()
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument()
    // 弹窗打开期间 Ctrl+= 不应触发全局 zoom，CSS 变量应保持初始值
    fireEvent.keyDown(window, { key: '=', ctrlKey: true })
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('13px')
    // Escape 应关闭弹窗（弹窗自己的监听器不受影响）
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull()
  })
})

describe('App 导出故事包', () => {
  it('干净项目：选路径 → 打包 → notice 已导出', async () => {
    const sink: { dest: string; files: string[] }[] = []
    render(<App gateway={gwExport({ exportSink: sink })} />)
    await fileMenu('打开项目...')
    await fileMenu('导出故事包（.kip）...')
    // 成功提示用 status（非 alert）+ ok 着色，不能让人误以为是错误
    const ok = await screen.findByRole('status')
    expect(ok).toHaveTextContent('已导出到 /out/雾港.kip')
    expect(ok).toHaveClass('toolbar-notice', 'ok')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(sink).toEqual([{ dest: '/out/雾港.kip', files: ['main.kin', '末.kin'] }])
  })

  it('用户在保存对话框取消：不导出、不提示', async () => {
    const sink: { dest: string; files: string[] }[] = []
    render(<App gateway={gwExport({ saveKipPath: null, exportSink: sink })} />)
    await fileMenu('打开项目...')
    await fileMenu('导出故事包（.kip）...')
    // 给异步链一拍
    await new Promise((r) => setTimeout(r, 0))
    expect(sink).toEqual([])
    expect(screen.queryByText(/已导出到/)).not.toBeInTheDocument()
  })

  it('脏 tab：先确认保存再导出', async () => {
    const sink: { dest: string; files: string[] }[] = []
    render(<App gateway={gwExport({ exportSink: sink })} />)
    await fileMenu('打开项目...')
    // 改动入口 tab 使其变脏
    await typeInEditor('x')
    await fileMenu('导出故事包（.kip）...')   // memory confirm 默认返 true
    expect(await screen.findByText('已导出到 /out/雾港.kip')).toBeInTheDocument()
    // 已保存：导出后入口内容含改动（确认保存确实先发生——不强断言文件内容，notice 出现即证明走通保存→导出）
    expect(sink.length).toBe(1)
  })

  it('打包抛错：notice 导出失败', async () => {
    const g = gwExport()
    g.exportKip = async () => { throw new Error('磁盘已满') }
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await fileMenu('导出故事包（.kip）...')
    // 失败提示仍是 alert + 错误着色
    const err = await screen.findByRole('alert')
    expect(err).toHaveTextContent('导出失败：磁盘已满')
    expect(err).toHaveClass('toolbar-notice', 'err')
  })

  it('脏 tab + 确认取消：不导出、不提示', async () => {
    const sink: { dest: string; files: string[] }[] = []
    render(<App gateway={gwExport({ exportSink: sink, confirmResult: false })} />)
    await fileMenu('打开项目...')
    // 改动入口 tab 使其变脏
    await typeInEditor('x')
    await fileMenu('导出故事包（.kip）...')   // confirm 返 false → 取消
    // 给异步链一拍
    await new Promise((r) => setTimeout(r, 0))
    expect(sink).toEqual([])
    expect(screen.queryByText(/已导出到/)).not.toBeInTheDocument()
  })
})

function gwExportWeb(over: { webpageDir?: string | null; webpageSink?: { dest: string; projectData: string; files: string[] }[]; confirmResult?: boolean } = {}) {
  return createMemoryGateway({
    pickedDir: '/proj',
    newDir: '/fresh',
    files: { '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }), '/proj/main.kin': MAIN, '/proj/末.kin': END },
    webpageDir: 'webpageDir' in over ? over.webpageDir : '/out',
    webpageSink: over.webpageSink,
    confirmResult: over.confirmResult,
  })
}

describe('App 导出独立网页', () => {
  it('干净项目：选父目录 → 导出 → notice + 内联数据含 manifest 与 .kin', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    render(<App gateway={gwExportWeb({ webpageSink: sink })} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    const ok = await screen.findByRole('status')
    expect(ok).toHaveTextContent('已导出到 /out/雾港-web')
    expect(sink.length).toBe(1)
    const data = JSON.parse(sink[0].projectData) as { manifest: string; files: Record<string, string>; assetBase: string }
    expect(JSON.parse(data.manifest).name).toBe('雾港')
    expect(data.files['main.kin']).toContain('开场。')
    expect(data.assetBase).toBe('')
  })

  it('用户在目录对话框取消：不导出、不提示', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    render(<App gateway={gwExportWeb({ webpageDir: null, webpageSink: sink })} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    await new Promise((r) => setTimeout(r, 0))
    expect(sink).toEqual([])
    expect(screen.queryByText(/已导出到/)).not.toBeInTheDocument()
  })

  it('脏 tab：先确认保存再导出', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    render(<App gateway={gwExportWeb({ webpageSink: sink })} />)
    await fileMenu('打开项目...')
    await typeInEditor('x')
    await fileMenu('导出独立网页...')   // memory confirm 默认返 true
    expect(await screen.findByText('已导出到 /out/雾港-web')).toBeInTheDocument()
    expect(sink.length).toBe(1)
    // 已保存：内联数据含改动后的入口源码（确认保存确实先于导出）
    const data = JSON.parse(sink[0].projectData) as { files: Record<string, string> }
    expect(data.files['main.kin']).toContain('x')
  })

  it('导出抛错：notice 导出失败', async () => {
    const g = gwExportWeb()
    g.exportWebpage = async () => { throw new Error('磁盘已满') }
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    const err = await screen.findByRole('alert')
    expect(err).toHaveTextContent('导出失败：磁盘已满')
  })
})

describe('App 布局快照（保存 / 恢复布局）', () => {
  beforeEach(() => { localStorage.clear() })

  async function viewMenu(item: string) {
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: item }))
  }
  const readView = () => JSON.parse(localStorage.getItem('kiny-editor-view') || '{}')

  it('保存当前布局：写入 kiny-editor-view-saved 且等于当前 view，并弹成功提示', async () => {
    render(<App gateway={gw()} />)
    // 先调乱一处布局（关预览面板），使当前 view 区别于默认
    await viewMenu('预览面板')
    expect(readView().preview).toBe(false)
    await viewMenu('保存当前布局')
    expect(await screen.findByText('已保存当前布局')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('kiny-editor-view-saved')!)
    expect(saved.preview).toBe(false)
    expect(saved).toEqual(readView())
  })

  it('未存过快照时视图菜单不出现「恢复我的布局」，保存后出现', async () => {
    render(<App gateway={gw()} />)
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    expect(await screen.findByRole('menuitem', { name: '保存当前布局' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '恢复我的布局' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('menuitem', { name: '保存当前布局' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    expect(await screen.findByRole('menuitem', { name: '恢复我的布局' })).toBeInTheDocument()
  })

  it('恢复我的布局：把 view 还原为已存快照', async () => {
    render(<App gateway={gw()} />)
    await viewMenu('预览面板')      // preview: false
    await viewMenu('保存当前布局')   // 快照 preview=false
    await viewMenu('预览面板')      // 再调乱回 preview: true
    expect(readView().preview).toBe(true)
    await viewMenu('恢复我的布局')
    await waitFor(() => expect(readView().preview).toBe(false))
  })

  it('恢复默认布局：把 view 还原为出厂默认', async () => {
    render(<App gateway={gw()} />)
    await viewMenu('预览面板')      // preview: false（默认是 true）
    await viewMenu('语义着色')      // highlight: false（默认是 true）
    expect(readView().preview).toBe(false)
    await viewMenu('恢复默认布局')
    await waitFor(() => {
      const v = readView()
      expect(v.preview).toBe(true)
      expect(v.highlight).toBe(true)
    })
  })

  it('前向兼容：saved 快照缺字段时，恢复后该字段取默认', async () => {
    // 预置一份缺 sidebarWidth 的旧快照
    localStorage.setItem('kiny-editor-view-saved', JSON.stringify({ preview: false }))
    render(<App gateway={gw()} />)
    await viewMenu('恢复我的布局')
    await waitFor(() => {
      const v = readView()
      expect(v.preview).toBe(false)     // 快照里有 → 生效
      expect(v.sidebarWidth).toBe(232)  // 快照缺 → 取 DEFAULT_VIEW 默认
    })
  })
})

describe('App 预览随机种子（T029）', () => {
  beforeEach(() => { localStorage.clear() })
  const seedText = () => screen.getByText(/^种子 #/).textContent

  it('确定性模式（默认）：↺ 重开预览种子恒为 #5eed', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    expect(await screen.findByText('种子 #5eed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '↺ 重开预览' }))
    // ↺ 后仍确定性回落固定种子
    expect(screen.getByText('种子 #5eed')).toBeInTheDocument()
  })

  it('随机模式：↺ 重开预览换新随机种子（stub Math.random）', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ previewRandomSeed: true }))
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5) // → floor(0.5*2^32)>>>0 = 0x80000000
    try {
      render(<App gateway={gw()} />)
      await fileMenu('打开项目...')
      // 开档时未 ↺，仍是初始固定种子
      expect(await screen.findByText('种子 #5eed')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '↺ 重开预览' }))
      expect(await screen.findByText('种子 #80000000')).toBeInTheDocument()
    } finally { rnd.mockRestore() }
  })

  it('随机模式下编辑期种子稳定：敲键重算不换种子', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ previewRandomSeed: true }))
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      render(<App gateway={gw()} />)
      await fileMenu('打开项目...')
      await screen.findByText('种子 #5eed')
      await typeInEditor('x') // 编辑触发防抖校验 + recompute
      await waitFor(() => expect(editorValue()).toContain('x'))
      // 编辑期 recompute 读 seedRef、绝不 reseed → 种子仍固定
      expect(seedText()).toBe('种子 #5eed')
    } finally { rnd.mockRestore() }
  })
})

describe('App 导入资源（T027）', () => {
  beforeEach(() => { localStorage.clear() })

  function gwImport(over: { importPicks?: string[] | null; extraFiles?: Record<string, string> } = {}) {
    const sink: { dir: string; destRel: string; sourceAbsPath: string }[] = []
    const gateway = createMemoryGateway({
      pickedDir: '/proj', newDir: '/fresh',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN, '/proj/末.kin': END, ...over.extraFiles,
      },
      importPicks: over.importPicks ?? null,
      importSink: sink,
    })
    return { gateway, sink }
  }
  const explorer = () => screen.getByRole('navigation', { name: '资源管理器' })
  const importVia = (rowText: string) => {
    fireEvent.contextMenu(within(explorer()).getByText(rowText))
    fireEvent.click(screen.getByText('导入资源…'))
  }

  it('右键根级文件 → 导入 → importAsset(项目根, 文件名, 源路径) + 新 entry 出现在树', async () => {
    const { gateway, sink } = gwImport({ importPicks: ['/ext/pic.png'] })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    importVia('main.kin') // main.kin 在根 → 目标 ''
    await waitFor(() => expect(sink).toEqual([{ dir: '/proj', destRel: 'pic.png', sourceAbsPath: '/ext/pic.png' }]))
    expect(await within(explorer()).findByText('pic.png')).toBeInTheDocument()
  })

  it('取消选择（pickImportFiles 返回 null）→ 不导入', async () => {
    const { gateway, sink } = gwImport({ importPicks: null })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    importVia('main.kin')
    await Promise.resolve()
    expect(sink).toEqual([])
  })

  it('同名冲突 → 覆盖 → importAsset 同路径', async () => {
    const { gateway, sink } = gwImport({ importPicks: ['/ext/pic.png'], extraFiles: { '/proj/pic.png': 'X' } })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    importVia('main.kin')
    await userEvent.click(await screen.findByRole('button', { name: '覆盖' }))
    await waitFor(() => expect(sink).toEqual([{ dir: '/proj', destRel: 'pic.png', sourceAbsPath: '/ext/pic.png' }]))
  })

  it('同名冲突 → 改名 → importAsset 唯一路径 pic-1.png', async () => {
    const { gateway, sink } = gwImport({ importPicks: ['/ext/pic.png'], extraFiles: { '/proj/pic.png': 'X' } })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    importVia('main.kin')
    await userEvent.click(await screen.findByRole('button', { name: '改名' }))
    await waitFor(() => expect(sink).toEqual([{ dir: '/proj', destRel: 'pic-1.png', sourceAbsPath: '/ext/pic.png' }]))
  })

  it('同名冲突 → 跳过 → 不调 importAsset', async () => {
    const { gateway, sink } = gwImport({ importPicks: ['/ext/pic.png'], extraFiles: { '/proj/pic.png': 'X' } })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    importVia('main.kin')
    await userEvent.click(await screen.findByRole('button', { name: '跳过' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '资源同名冲突' })).toBeNull())
    expect(sink).toEqual([])
  })

  it('多文件多冲突 → 勾「应用到其余」+ 改名 → 只弹一次、其余同样改名', async () => {
    const { gateway, sink } = gwImport({
      importPicks: ['/ext/a.png', '/ext/b.png'],
      extraFiles: { '/proj/a.png': 'X', '/proj/b.png': 'Y' },
    })
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    importVia('main.kin')
    // 第一个冲突弹框：勾选应用到其余，选改名
    await userEvent.click(await screen.findByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: '改名' }))
    // 第二个冲突不再弹框，自动改名
    await waitFor(() => expect(sink).toEqual([
      { dir: '/proj', destRel: 'a-1.png', sourceAbsPath: '/ext/a.png' },
      { dir: '/proj', destRel: 'b-1.png', sourceAbsPath: '/ext/b.png' },
    ]))
    expect(screen.queryByRole('dialog', { name: '资源同名冲突' })).toBeNull()
  })
})
