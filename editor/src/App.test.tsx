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
    files: { '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }), ...files },
  })
}

function gwExport(over: { saveKipPath?: string | null; exportSink?: { dest: string; files: string[] }[]; confirmResult?: boolean } = {}) {
  return createMemoryGateway({
    pickedDir: '/proj',
    files: { '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }), '/proj/main.kin': MAIN, '/proj/末.kin': END },
    saveKipPath: 'saveKipPath' in over ? over.saveKipPath : '/out/雾港.kip',
    exportSink: over.exportSink,
    confirmResult: over.confirmResult,
  })
}

// 经菜单「文件 → <item>」点击。
// 冷启动（无项目）时顶层是启动页、无菜单栏：新建 / 打开项目改走启动页按钮。
async function fileMenu(item: string) {
  if (!screen.queryByRole('menuitem', { name: '文件' })) {
    if (item === '打开项目...') { await userEvent.click(screen.getByRole('button', { name: /打开项目/ })); return }
    if (item === '新建项目...') { await userEvent.click(screen.getByRole('button', { name: /新建项目/ })); return }
  }
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

  it('Ctrl+N 打开新建项目弹窗', async () => {
    render(<App gateway={gw()} />)
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: '新建项目' })).toBeInTheDocument()
  })

  it('F1 打开语法参考帮助屏；Ctrl+/ 不再开帮助（改为编辑器注释）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    // Ctrl+/ 不再触发帮助屏
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'Kiny 语法参考' })).toBeNull()
    // F1 打开帮助屏
    fireEvent.keyDown(window, { key: 'F1' })
    expect(await screen.findByRole('dialog', { name: 'Kiny 语法参考' })).toBeInTheDocument()
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

  it('预览「← 上一步」→ 撤销上一次选择、回上一决定点；起点处按钮禁用（T044）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    const preview = screen.getByTestId('preview')
    // 预览起点：seq 空 → 上一步禁用
    expect(await screen.findByRole('button', { name: '向左' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /上一步/ })).toBeDisabled()
    // 前进一步 → 上一步启用
    await userEvent.click(screen.getByRole('button', { name: '向左' }))
    expect(await within(preview).findByText('你往左走。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /上一步/ })).toBeEnabled()
    // 上一步 → 回到开场（选项重现、上一步叙事消失），回到起点按钮再度禁用
    await userEvent.click(screen.getByRole('button', { name: /上一步/ }))
    expect(await screen.findByRole('button', { name: '向左' })).toBeInTheDocument()
    expect(within(preview).queryByText('你往左走。')).toBeNull()
    expect(screen.getByRole('button', { name: /上一步/ })).toBeDisabled()
  })

  it('打开 IO 失败 → role=alert 通知、项目名不载入', async () => {
    const gateway = gw()
    vi.spyOn(gateway, 'readProject').mockRejectedValue(new Error('读盘炸了'))
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    expect(await screen.findByRole('alert')).toHaveTextContent('读盘炸了')
    expect(screen.queryByText('雾港')).toBeNull()
  })

  it('新建项目 → 填名称 + 浏览位置 + 创建 → 脚手架载入、菜单栏显示项目名', async () => {
    const gateway = createMemoryGateway({ files: {}, newParent: '/loc' })
    render(<App gateway={gateway} />)
    await fileMenu('新建项目...')
    await userEvent.type(await screen.findByRole('textbox', { name: '项目名称' }), '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0)
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

  // 设置经菜单栏进入，而菜单栏只在有项目时渲染（启动页无菜单）：先确保项目已打开。
  async function openSettings() {
    if (!screen.queryByRole('menuitem', { name: '视图' })) await fileMenu('打开项目...')
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
    await fileMenu('打开项目...') // 设置弹窗随 workbench 挂载，先进项目
    await screen.findAllByText('雾港')
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
    expect(await screen.findByText(/^已导出到 \/out\/雾港-web/)).toBeInTheDocument()
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

  it('作品主题：css 内联进 css 字段（不进故事文件表），字体 url() 重写为 data-URI', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/theme/skin.css': '.player{--kiny-page-bg:#fff}',
        '/proj/fonts/楷体.woff2': 'FONTBYTES',
      },
      webpageDir: '/out',
      webpageSink: sink,
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    // 等导出真正落到 sink（字体 data-URI 是额外一轮异步读，别只等提示出现）
    await waitFor(() => expect(sink.length).toBe(1))
    const data = JSON.parse(sink[0].projectData) as { files: Record<string, string>; css: string }
    expect(Object.keys(data.files)).toEqual(['main.kin']) // css 不混进故事文件
    expect(data.css).toContain('--kiny-page-bg:#fff')
    expect(data.css).toContain('font-family: "楷体"')
    expect(data.css).toContain('url("data:') // 字体内联，file:// 下才加载得到
  })

  /** 内联数据里的 manifest 是 JSON 文本，取其 id 用。 */
  const idOfExport = (projectData: string) =>
    (JSON.parse((JSON.parse(projectData) as { manifest: string }).manifest) as { id?: string }).id

  it('manifest 无 id：导出前补写回项目文件，导出数据带同一个 id', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    const g = gwExportWeb({ webpageSink: sink })
    const written: unknown[] = []
    const origWrite = g.writeManifest
    g.writeManifest = async (dir, manifest, file) => { written.push(manifest); return origWrite(dir, manifest, file) }
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    await waitFor(() => expect(sink.length).toBe(1))
    const id = idOfExport(sink[0].projectData)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(written).toHaveLength(1)
    expect((written[0] as { id?: string }).id).toBe(id) // 写回项目文件的与导出进网页的是同一个
    expect(await screen.findByText(/已为本作品写入唯一标识/)).toBeInTheDocument()
  })

  it('同一 session 连续导出两次：id 不变，只写回一次', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    const g = gwExportWeb({ webpageSink: sink })
    let writes = 0
    const origWrite = g.writeManifest
    g.writeManifest = async (dir, manifest, file) => { writes++; return origWrite(dir, manifest, file) }
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    await waitFor(() => expect(sink.length).toBe(1))
    await fileMenu('导出独立网页...')
    await waitFor(() => expect(sink.length).toBe(2))
    expect(idOfExport(sink[0].projectData)).toBe(idOfExport(sink[1].projectData))
    expect(writes).toBe(1)
  })

  it('写回 manifest 失败：导出照常，但数据不带 id（退回按故事名分桶）且提示降级', async () => {
    const sink: { dest: string; projectData: string; files: string[] }[] = []
    const g = gwExportWeb({ webpageSink: sink })
    g.writeManifest = async () => { throw new Error('只读目录') }
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await fileMenu('导出独立网页...')
    await waitFor(() => expect(sink.length).toBe(1))
    // 一次性随机 id 比没有更糟：作者每导出一次就换一个桶，读者每升级一版都无声丢档
    expect(idOfExport(sink[0].projectData)).toBeUndefined()
    expect(await screen.findByText(/未能写入作品标识/)).toBeInTheDocument()
  })
})

describe('App 作品前端资源（T077）', () => {
  function gwTheme(css = '.player{--kiny-page-bg:#fff}') {
    return createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/theme.css': css,
        '/proj/assets/bg.png': 'PNGBYTES',
      },
    })
  }
  const styleTexts = () => Array.from(document.querySelectorAll('style[data-kiny-project-styles]')).map((s) => s.textContent ?? '')
  /** `.css` 打开的是双模编辑器，默认停在「外观」；要文本编辑器就切「原文」。 */
  const openRawTab = async () => userEvent.click(await screen.findByRole('tab', { name: '原文' }))

  it('只有 theme.css 带「外观」页：别的 .css 是纯文本编辑器', async () => {
    // 零目录约定下全部 .css 按字典序叠加。在第二个样式文件里开外观页，它会把 player 默认值
    // 当成「这个作品现在的样子」显示（其实生效的是 theme.css 的值），随手一拖就把 token 写进
    // 这个文件、按字典序盖死 theme.css——而单文件扫描看不见这件事，连提示都不会有。
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/theme.css': '.player{--kiny-page-bg:#fff}',
        '/proj/zz-panel.css': '.player .panel-bottom{background:#000}',
      },
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await userEvent.click((await screen.findAllByText('zz-panel.css'))[0])
    await waitFor(() => expect(cmView().state.doc.toString()).toContain('panel-bottom'))
    expect(screen.queryByRole('tab', { name: '外观' })).not.toBeInTheDocument()

    await userEvent.click((await screen.findAllByText('theme.css'))[0])
    expect(await screen.findByRole('tab', { name: '外观' })).toBeInTheDocument()
  })

  it('theme.css 的判定不分大小写', async () => {
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/Theme.CSS': '.player{--kiny-text:#fff}',
      },
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await userEvent.click((await screen.findAllByText('Theme.CSS'))[0])
    expect(await screen.findByRole('tab', { name: '外观' })).toBeInTheDocument()
  })

  it('打开项目 → 预览注入作品主题 css；点资源管理器里的 .css 得双模编辑器，原文页可编辑', async () => {
    render(<App gateway={gwTheme()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    expect(styleTexts().join('')).toContain('--kiny-page-bg:#fff')

    await userEvent.click((await screen.findAllByText('theme.css'))[0])
    expect(await screen.findByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true')
    await openRawTab()
    await waitFor(() => expect(cmView().state.doc.toString()).toBe('.player{--kiny-page-bg:#fff}'))
  })

  it('注入预览的作品 css 被限定到预览容器：越界选择器影响不到编辑器界面（T094）', async () => {
    render(<App gateway={gwTheme('body{background:red}\n.player p{color:blue}')} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    const css = styleTexts().join('')
    // 作者的 `body{}` 映射成了预览容器自身，`.player p` 加了容器前缀——两条都出不了预览区。
    expect(css).toContain(':where(.preview-stage){background:red}')
    expect(css).toContain(':where(.preview-stage) .player p{color:blue}')
    // 未限定的裸 body 规则一条都不能留在文档里。
    expect(css).not.toMatch(/(^|[};])\s*body\s*\{/)
  })

  it('外观页调 token → 定点写回、预览即时换肤（无需保存）', async () => {
    render(<App gateway={gwTheme()} />)
    await fileMenu('打开项目...')
    await userEvent.click((await screen.findAllByText('theme.css'))[0])
    fireEvent.change(await screen.findByLabelText('页面底色'), { target: { value: '#123456' } })
    await waitFor(() => expect(styleTexts().join('')).toContain('#123456'))
  })

  it('编辑 css 原文 → 预览即时重注入（无需保存）', async () => {
    render(<App gateway={gwTheme()} />)
    await fileMenu('打开项目...')
    await userEvent.click((await screen.findAllByText('theme.css'))[0])
    await openRawTab()
    await typeInEditor('/*x*/')
    await waitFor(() => expect(styleTexts().join('')).toContain('/*x*/'))
  })

  it('校验只吃 .kin：css 内容不产出 Kin 诊断', async () => {
    render(<App gateway={gwTheme('这不是 Kin 语法 @@@ {')} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await new Promise((r) => setTimeout(r, 400)) // 等防抖校验跑完
    expect(screen.queryByText(/theme\.css/)).not.toBeNull() // 文件在资源管理器里
    expect(document.querySelector('.diag-row')).toBeNull() // 但没有诊断
  })

  it('导入 .css 资源 → 立刻可编辑且即刻计入预览主题（不必重开项目）', async () => {
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        // 导入源：memoryGateway 的 importAsset 会把内容写成 <binary:…> 占位，
        // 故这里断言「文本资源被回读进缓冲」而非具体内容。
      },
      importPicks: ['/ext/theme.css'],
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    fireEvent.contextMenu(within(explorer).getByText('main.kin')) // 右键根级文件 → 导入到项目根
    fireEvent.click(screen.getByText('导入资源…'))
    // 导入后进了缓冲：新 tab 打开且编辑区拿到文本（不是「未打开文件」的空态）。
    // `.css` 开的是双模编辑器，文本在「原文」页。
    await openRawTab()
    await waitFor(() => expect(cmView().state.doc.toString()).toContain('binary'))
  })

  it('「文件 → 作品主题…」：项目里没有 .css 时按模板新建 theme.css 并打开', async () => {
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
      },
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await fileMenu('作品主题...')
    // 新建的 theme.css 已打开为双模编辑器，且模板里的 token 已回填进控件
    expect(await screen.findByLabelText('页面底色')).toHaveValue('#0d1117')
    expect((await screen.findAllByText('theme.css')).length).toBeGreaterThan(0)
  })

  it('「文件 → 作品主题…」：已有 theme.css 时打开它，不重复新建', async () => {
    const g = gwTheme()
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await fileMenu('作品主题...')
    expect(await screen.findByRole('tab', { name: '外观' })).toBeInTheDocument()
    // 打开的是原有那个文件（内容还在），没有被新建覆盖
    expect(await g.readTextFile('/proj', 'theme.css')).toBe('.player{--kiny-page-bg:#fff}')
  })

  it('「文件 → 作品角色…」：项目里没有角色表时按模板新建 characters.json 并打开', async () => {
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
      },
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await fileMenu('作品角色...')
    // 新建的 characters.json 已打开为角色编辑器，模板里的两个示例角色进了 GUI
    expect(await screen.findByRole('tab', { name: '角色' })).toBeInTheDocument()
    const names = screen.getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)
    expect(names).toEqual(['克里斯托弗', '阿黎娅'])
    expect((await screen.findAllByText('characters.json')).length).toBeGreaterThan(0)
  })

  it('「文件 → 作品角色…」：已有 characters.json 时打开它，不重复新建', async () => {
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/characters.json': '{"林然":{}}',
      },
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await fileMenu('作品角色...')
    expect(await screen.findByRole('tab', { name: '角色' })).toBeInTheDocument()
    // 打开的是原有那个文件（内容还在），没有被模板覆盖
    expect(await g.readTextFile('/proj', 'characters.json')).toBe('{"林然":{}}')
    expect(screen.getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)).toEqual(['林然'])
  })

  it('资源问题（非法族名）→ 预览栏出现提示角标', async () => {
    const g = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/字体(粗).woff2': 'FONT',
      },
    })
    render(<App gateway={g} />)
    await fileMenu('打开项目...')
    expect(await screen.findByText(/资源 1 项问题/)).toBeInTheDocument()
  })

  it('设置里关掉「预览应用作品主题」→ 不再注入', async () => {
    localStorage.clear()
    render(<App gateway={gwTheme()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '设置...' }))
    await userEvent.click(await screen.findByRole('tab', { name: '编辑器' }))
    await userEvent.click(await screen.findByRole('switch', { name: '预览应用作品主题' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(styleTexts().join('')).not.toContain('--kiny-page-bg:#fff'))
  })
})

describe('App 布局快照（保存 / 恢复布局）', () => {
  beforeEach(() => { localStorage.clear() })

  // 视图菜单只在有项目时渲染（启动页无菜单栏）：先确保项目已打开。
  async function viewMenu(item: string) {
    if (!screen.queryByRole('menuitem', { name: '视图' })) await fileMenu('打开项目...')
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: item }))
  }
  const readView = () => JSON.parse(localStorage.getItem('kiny-editor-view') || '{}')

  it('保存当前布局：写入 kiny-editor-view-saved 且等于当前 view，并弹成功提示', async () => {
    render(<App gateway={gw()} />)
    // 先调乱一处布局（关右侧面板），使当前 view 区别于默认
    await viewMenu('预览 / 结构图面板')
    expect(readView().preview).toBe(false)
    await viewMenu('保存当前布局')
    expect(await screen.findByText('已保存当前布局')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('kiny-editor-view-saved')!)
    expect(saved.preview).toBe(false)
    expect(saved).toEqual(readView())
  })

  it('未存过快照时视图菜单不出现「恢复我的布局」，保存后出现', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...') // 菜单栏随 workbench 挂载，先进项目
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    expect(await screen.findByRole('menuitem', { name: '保存当前布局' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '恢复我的布局' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('menuitem', { name: '保存当前布局' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    expect(await screen.findByRole('menuitem', { name: '恢复我的布局' })).toBeInTheDocument()
  })

  it('恢复我的布局：把 view 还原为已存快照', async () => {
    render(<App gateway={gw()} />)
    await viewMenu('预览 / 结构图面板')  // preview: false
    await viewMenu('保存当前布局')        // 快照 preview=false
    await viewMenu('预览 / 结构图面板')  // 再调乱回 preview: true
    expect(readView().preview).toBe(true)
    await viewMenu('恢复我的布局')
    await waitFor(() => expect(readView().preview).toBe(false))
  })

  it('恢复默认布局：把 view 还原为出厂默认', async () => {
    render(<App gateway={gw()} />)
    await viewMenu('预览 / 结构图面板')  // preview: false（默认是 true）
    await viewMenu('语义着色')            // highlight: false（默认是 true）
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
      pickedDir: '/proj',
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

describe('项目设置弹窗（T036）', () => {
  it('打开「项目设置...」→ 弹窗以当前 manifest 填充', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('项目设置...')
    const dlg = await screen.findByRole('dialog', { name: '项目设置' })
    expect((within(dlg).getByLabelText('项目名称') as HTMLInputElement).value).toBe('雾港')
    expect((within(dlg).getByLabelText('启动入口') as HTMLSelectElement).value).toBe('main.kin')
    const opts = Array.from((within(dlg).getByLabelText('启动入口') as HTMLSelectElement).options).map((o) => o.value)
    expect(opts).toEqual(['main.kin', '末.kin'])
  })

  it('改启动入口保存 → writeManifest 写新 entry、manifestFile 不变、无 rename、弹窗关闭', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeManifest')
    const renameSpy = vi.spyOn(gateway, 'renamePath')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('项目设置...')
    await userEvent.selectOptions(await screen.findByLabelText('启动入口'), '末.kin')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(writeSpy).toHaveBeenCalled())
    const [dir, manifest, manifestFile] = writeSpy.mock.calls[0]
    expect(dir).toBe('/proj')
    expect(manifest).toMatchObject({ name: '雾港', entry: '末.kin' })
    expect(manifestFile).toBe('雾港.kiw') // kiny.json 打开时已迁移
    expect(renameSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '项目设置' })).toBeNull())
    // 改入口后预览重算：从 末.kin 起始渲染（bump runId 触发），不再停在 main.kin
    const preview = screen.getByTestId('preview')
    await waitFor(() => expect(within(preview).getByText('你往右走。')).toBeInTheDocument())
  })

  it('保存项目设置保留作品 id（它一旦被换掉，读者的存档全体失联）', async () => {
    const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const gateway = createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin', id: ID }),
        '/proj/main.kin': MAIN,
        '/proj/末.kin': END,
      },
    })
    const writeSpy = vi.spyOn(gateway, 'writeManifest')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('项目设置...')
    await userEvent.selectOptions(await screen.findByLabelText('启动入口'), '末.kin')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(writeSpy).toHaveBeenCalled())
    expect(writeSpy.mock.calls[0][1]).toMatchObject({ entry: '末.kin', id: ID })
  })

  it('改项目名保存 → rename manifest 文件到新名 + 写内容，菜单栏项目名更新', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeManifest')
    const renameSpy = vi.spyOn(gateway, 'renamePath')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('项目设置...')
    const nameInput = await screen.findByLabelText('项目名称')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '新名')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(renameSpy).toHaveBeenCalledWith('/proj', '雾港.kiw', '新名.kiw'))
    expect(writeSpy).toHaveBeenCalledWith('/proj', expect.objectContaining({ name: '新名' }), '新名.kiw')
    expect((await screen.findAllByText('新名')).length).toBeGreaterThan(0)
  })

  it('改名目标已存在（rename 抛错）→ 不写内容、报错、弹窗留驻', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeManifest')
    vi.spyOn(gateway, 'renamePath').mockRejectedValue(new Error('目标已存在: 新名.kiw'))
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('项目设置...')
    const nameInput = await screen.findByLabelText('项目名称')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '新名')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText(/保存项目设置失败/)
    expect(writeSpy).not.toHaveBeenCalled() // rename 先失败，未触及写内容
    expect(screen.getByRole('dialog', { name: '项目设置' })).toBeInTheDocument()
  })

  it('rename 成功但写内容失败 → 提示「已重命名但写入失败」、弹窗留驻', async () => {
    const gateway = gw()
    vi.spyOn(gateway, 'writeManifest').mockRejectedValue(new Error('磁盘满'))
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('项目设置...')
    const nameInput = await screen.findByLabelText('项目名称')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '新名')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText(/项目文件已重命名，但写入内容失败/)
    expect(screen.getByRole('dialog', { name: '项目设置' })).toBeInTheDocument()
  })
})

describe('工作台 grid 布局：面板显隐不错位（T035）', () => {
  // 视图菜单只在有项目时渲染（启动页无菜单栏）：先确保项目已打开。
  async function viewMenu(item: string) {
    if (!screen.queryByRole('menuitem', { name: '视图' })) await fileMenu('打开项目...')
    await userEvent.click(screen.getByRole('menuitem', { name: '视图' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: item }))
  }
  const gridCol = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.style.gridColumn
  const colVar = (name: string) => (document.querySelector('.workbench') as HTMLElement).style.getPropertyValue(name)

  it('默认布局：sidebar / editor / 右侧面板各就各列（1/2/3）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    expect(gridCol('.sidebar')).toBe('1')
    expect(gridCol('.editor-col')).toBe('2')
    expect(gridCol('.right-dock')).toBe('3')
  })

  it('右侧面板 tab：默认预览，切到结构图 → 同一列内换成结构图（一次只显示一个）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    // 默认显示预览、无结构图
    expect(document.querySelector('.preview-pane')).not.toBeNull()
    expect(document.querySelector('.story-graph')).toBeNull()
    expect(gridCol('.right-dock')).toBe('3')
    // 切到结构图 → 预览换成结构图，仍在第 3 列
    await userEvent.click(screen.getByRole('button', { name: '结构图' }))
    await waitFor(() => expect(document.querySelector('.story-graph')).not.toBeNull())
    expect(document.querySelector('.preview-pane')).toBeNull()
    expect(gridCol('.right-dock')).toBe('3')
    expect(gridCol('.editor-col')).toBe('2')
    // 切回预览
    await userEvent.click(screen.getByRole('button', { name: '预览' }))
    await waitFor(() => expect(document.querySelector('.preview-pane')).not.toBeNull())
    expect(document.querySelector('.story-graph')).toBeNull()
  })

  it('隐藏侧栏：editor 仍落第 2 列、右侧面板仍第 3 列（不被压进 0px 侧栏轨道）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await viewMenu('节点导航 / 资源管理器')
    await waitFor(() => expect(document.querySelector('.sidebar')).toBeNull())
    expect(gridCol('.editor-col')).toBe('2')
    expect(gridCol('.right-dock')).toBe('3')
  })

  it('隐藏右侧面板：editor 仍落第 2 列，且 --col-editor 变 1fr 撑满（不留半屏空白）', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    // 显示时 editor 列按 editorRatio 分（默认 0.5fr），与右侧面板的 0.5fr 之和 = 1
    expect(colVar('--col-editor')).toBe('0.5fr')
    await viewMenu('预览 / 结构图面板')
    await waitFor(() => expect(document.querySelector('.right-dock')).toBeNull())
    expect(gridCol('.editor-col')).toBe('2')
    // 关键：隐藏后 editor 必须是 1fr（孤立的 0.5fr 因 CSS Grid max(1,Σfr) 只填一半、右侧留白）
    expect(colVar('--col-editor')).toBe('1fr')
    expect(colVar('--col-preview')).toBe('0px')
  })

  it('显示 AI 面板：ai 落第 4 列、editor 不动', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await viewMenu('AI 面板')
    await waitFor(() => expect(document.querySelector('.ai-panel')).not.toBeNull())
    expect(gridCol('.ai-panel')).toBe('4')
    expect(gridCol('.editor-col')).toBe('2')
  })
})

describe('App 启动页 / 关闭项目（T034）', () => {
  beforeEach(() => { localStorage.clear() })

  it('冷启动无项目 → 顶层渲染启动页、无菜单栏、无 workbench', () => {
    render(<App gateway={gw()} />)
    expect(document.querySelector('.launch')).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: '文件' })).toBeNull()
    expect(document.querySelector('.workbench')).toBeNull()
  })

  it('启动页「打开项目」→ 进入 workbench、启动页消失', async () => {
    render(<App gateway={gw()} />)
    await userEvent.click(screen.getByRole('button', { name: /打开项目/ }))
    await screen.findAllByText('雾港')
    expect(document.querySelector('.workbench')).not.toBeNull()
    expect(document.querySelector('.launch')).toBeNull()
  })

  it('启动页列出最近项目并可点击打开', async () => {
    // 预置一条最近项目会话（指向 gw 的 /proj）
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1,
      projects: { '/proj': { openTabs: ['main.kin'], activeFile: 'main.kin', ts: 1, name: '雾港' } },
    }))
    render(<App gateway={gw()} />)
    // 启动页最近项目区显示该项目名 + 路径
    expect(screen.getByText('/proj')).toBeInTheDocument()
    await userEvent.click(screen.getByText('/proj'))
    await screen.findAllByText('雾港')
    expect(document.querySelector('.workbench')).not.toBeNull()
  })

  it('最近项目失效（目录读取失败）→ 提示 + 从列表移除', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1,
      projects: { '/gone': { openTabs: [], activeFile: null, ts: 1, name: '已失效' } },
    }))
    const gateway = gw()
    gateway.readProject = async () => { throw new Error('目录不存在') }
    render(<App gateway={gateway} />)
    expect(screen.getByText('/gone')).toBeInTheDocument()
    await userEvent.click(screen.getByText('/gone'))
    // 打开失败提示 + 该失效条目从启动页列表消失
    expect(await screen.findByRole('alert')).toHaveTextContent('打开项目失败')
    await waitFor(() => expect(screen.queryByText('/gone')).toBeNull())
  })

  it('启动页最近项目：点删除 → 确认 → 从列表与会话存储移除（不影响另一项）', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1,
      projects: {
        '/proj/a': { openTabs: [], activeFile: null, ts: 200, name: '雾港之夜' },
        '/proj/b': { openTabs: [], activeFile: null, ts: 100, name: '星辰彼端' },
      },
    }))
    render(<App gateway={gw()} />)
    // 启动页列出两项
    expect(await screen.findByText('雾港之夜')).toBeInTheDocument()
    expect(screen.getByText('星辰彼端')).toBeInTheDocument()
    // 点「雾港之夜」的删除键 → 弹确认框
    await userEvent.click(screen.getByRole('button', { name: '从最近项目移除 雾港之夜' }))
    expect(await screen.findByRole('dialog', { name: '从最近项目中移除' })).toBeInTheDocument()
    // 确认删除
    await userEvent.click(screen.getByRole('button', { name: '删除' }))
    // 列表只剩「星辰彼端」，会话存储也移除了 /proj/a
    await waitFor(() => expect(screen.queryByText('雾港之夜')).toBeNull())
    expect(screen.getByText('星辰彼端')).toBeInTheDocument()
    const store = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}')
    expect(store.projects['/proj/a']).toBeUndefined()
    expect(store.projects['/proj/b']).toBeDefined()
  })

  it('启动页按 Ctrl+, 不武装设置弹窗（进项目后不意外弹出）', async () => {
    render(<App gateway={gw()} />)
    fireEvent.keyDown(window, { key: ',', ctrlKey: true }) // 启动页，无 workbench
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    // 进入项目后不应残留、弹出设置弹窗
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull()
  })

  it('打开项目 → 窗口放大到 workbench 尺寸（1440×900）', async () => {
    const gateway = gw()
    const spy = vi.spyOn(gateway, 'setWindowSize')
    render(<App gateway={gateway} />)
    await userEvent.click(screen.getByRole('button', { name: /打开项目/ }))
    await screen.findAllByText('雾港')
    expect(spy).toHaveBeenCalledWith(1440, 900)
  })

  it('关闭项目 → 窗口缩回启动页尺寸（880×620）', async () => {
    const gateway = gw()
    const spy = vi.spyOn(gateway, 'setWindowSize')
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    spy.mockClear()
    await fileMenu('关闭项目')
    await waitFor(() => expect(document.querySelector('.launch')).not.toBeNull())
    expect(spy).toHaveBeenCalledWith(880, 620)
  })

  it('冷启动（无项目）不触发窗口尺寸调整', async () => {
    const gateway = gw()
    const spy = vi.spyOn(gateway, 'setWindowSize')
    render(<App gateway={gateway} />)
    // 停在启动页、未开项目 → 不应调窗（已是启动页默认尺寸）
    expect(document.querySelector('.launch')).not.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('进项目优先用记忆的 workbench 尺寸（曾手动调整过）', async () => {
    localStorage.setItem('kiny-editor-window', JSON.stringify({ width: 1600, height: 1000 }))
    const gateway = gw()
    const spy = vi.spyOn(gateway, 'setWindowSize')
    render(<App gateway={gateway} />)
    await userEvent.click(screen.getByRole('button', { name: /打开项目/ }))
    await screen.findAllByText('雾港')
    // 用记忆尺寸而非默认 1440×900
    expect(spy).toHaveBeenCalledWith(1600, 1000)
  })

  function gwResize(hook: { fire?: (w: number, h: number) => void }) {
    return createMemoryGateway({
      pickedDir: '/proj',
      files: { '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }), '/proj/main.kin': MAIN, '/proj/末.kin': END },
      resizeHook: hook,
    })
  }

  it('workbench 态手动调整窗口 → 记忆该尺寸', async () => {
    const hook: { fire?: (w: number, h: number) => void } = {}
    render(<App gateway={gwResize(hook)} />)
    await waitFor(() => expect(hook.fire).toBeDefined())
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    act(() => hook.fire!(1600, 1000))
    expect(JSON.parse(localStorage.getItem('kiny-editor-window')!)).toEqual({ width: 1600, height: 1000 })
  })

  it('启动页尺寸变化不记忆（无项目时 resize 不落库）', async () => {
    const hook: { fire?: (w: number, h: number) => void } = {}
    render(<App gateway={gwResize(hook)} />)
    await waitFor(() => expect(hook.fire).toBeDefined())
    // 停在启动页（projectDir null）时 resize
    act(() => hook.fire!(1000, 700))
    expect(localStorage.getItem('kiny-editor-window')).toBeNull()
  })

  it('关闭项目（干净）→ 回到启动页', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await fileMenu('关闭项目')
    await waitFor(() => expect(document.querySelector('.launch')).not.toBeNull())
    expect(document.querySelector('.workbench')).toBeNull()
  })

  it('关闭项目（有脏）→ 弹守卫；不保存并关闭 → 回启动页', async () => {
    render(<App gateway={gw()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
    await typeInEditor('x') // 弄脏入口
    await fileMenu('关闭项目')
    // 守卫弹出（关闭项目标题）
    expect(await screen.findByRole('dialog', { name: '关闭项目' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '不保存并关闭' }))
    await waitFor(() => expect(document.querySelector('.launch')).not.toBeNull())
  })
})

describe('App 媒体预览（T093）', () => {
  function gwMedia() {
    return createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': MAIN,
        '/proj/图/立绘.png': 'PNGBYTES',
        '/proj/音/雨.mp3': 'MP3BYTES',
        '/proj/字/楷体.woff2': 'FONTBYTES',
      },
    })
  }
  /** 展开资源管理器里的某文件夹（默认折叠），返回资源管理器容器。 */
  async function expandDir(name: string) {
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText(name))
    return explorer
  }

  it('点图片 → 编辑区出媒体查看器（img 指向资源 URL），右侧故事预览仍在', async () => {
    render(<App gateway={gwMedia()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    const explorer = await expandDir('图')
    await userEvent.click(within(explorer).getByText('立绘.png'))

    const view = await screen.findByTestId('media-view')
    const img = within(view).getByRole('img') as HTMLImageElement
    // ?v=计数：外部同步刷新用；本用例未触发同步，恒为初值 0。
    expect(img.getAttribute('src')).toBe('mem://图/立绘.png?v=0')
    expect(within(view).getByTestId('media-status').textContent).toContain('图/立绘.png')
    // 媒体 tab 与 .kin tab 并存，且右侧预览未被顶掉
    expect(screen.getByRole('tablist').textContent).toContain('图/立绘.png')
    expect(screen.getByTestId('preview')).toBeInTheDocument()
    // 文本编辑器让位给查看器（不是两者并存）
    expect(document.querySelector('.cm-editor')).toBeNull()
  })

  it('点音频 → 原生 audio 试听', async () => {
    render(<App gateway={gwMedia()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    const explorer = await expandDir('音')
    await userEvent.click(within(explorer).getByText('雨.mp3'))
    const audio = await screen.findByTestId('media-audio')
    expect(audio.getAttribute('src')).toBe('mem://音/雨.mp3?v=0')
  })

  it('点字体 → 不开 tab（没有查看器）', async () => {
    render(<App gateway={gwMedia()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    const explorer = await expandDir('字')
    await userEvent.click(within(explorer).getByText('楷体.woff2'))
    expect(screen.queryByTestId('media-view')).toBeNull()
    expect(screen.getByRole('tablist').textContent).not.toContain('楷体.woff2')
  })

  it('媒体 tab 与 .kin tab 之间来回切换：文本编辑器与查看器各自回位', async () => {
    render(<App gateway={gwMedia()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    const explorer = await expandDir('图')
    await userEvent.click(within(explorer).getByText('立绘.png'))
    await screen.findByTestId('media-view')

    const tabs = screen.getByRole('tablist')
    await userEvent.click(within(tabs).getByText('main.kin'))
    await waitFor(() => expect(editorValue()).toContain('开场。'))
    expect(screen.queryByTestId('media-view')).toBeNull()

    await userEvent.click(within(tabs).getByText('图/立绘.png'))
    expect(await screen.findByTestId('media-view')).toBeInTheDocument()
  })

  it('媒体 tab 永不脏：编辑过入口后关媒体 tab 不弹守卫，入口脏点不受影响', async () => {
    render(<App gateway={gwMedia()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    await typeInEditor('x') // 弄脏入口（媒体不该被卷入）
    const explorer = await expandDir('图')
    await userEvent.click(within(explorer).getByText('立绘.png'))
    await screen.findByTestId('media-view')

    await userEvent.click(screen.getByRole('button', { name: '关闭 图/立绘.png' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('media-view')).toBeNull())
    // 入口的脏点仍在（媒体 tab 的开关与保存状态无关）
    expect(document.querySelector('.tab-dirty')).not.toBeNull()
  })

  it('会话恢复：上次停在图片 tab → 重开项目仍回到该图片', async () => {
    render(<App gateway={gwMedia()} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('main.kin')
    const explorer = await expandDir('图')
    await userEvent.click(within(explorer).getByText('立绘.png'))
    await screen.findByTestId('media-view')
    await fileMenu('关闭项目')
    await waitFor(() => expect(document.querySelector('.launch')).not.toBeNull())

    await fileMenu('打开项目...')
    expect(await screen.findByTestId('media-view')).toBeInTheDocument()
    expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe('mem://图/立绘.png?v=0')
  })
})

describe('外部变更同步（T-watch）', () => {
  // 起一个 /proj 项目（main.kin + other.kin，均为自足内容，不依赖跨文件跳转），
  // 注入 watchHook，供各用例经 gateway 方法改内存文件后 fire() 模拟外部信号。
  const WMAIN = `开场。
一段可编辑的正文。
-> END
`
  const WOTHER = `=== 其它 ===
这里是一段测试文本。
-> END
`
  function gwWatch(watchHook: { fire?: () => void }, extra: Record<string, string> = {}) {
    return createMemoryGateway({
      pickedDir: '/proj',
      files: {
        '/proj/kiny.json': JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
        '/proj/main.kin': WMAIN,
        '/proj/other.kin': WOTHER,
        ...extra,
      },
      watchHook,
    })
  }

  async function openProject(gateway: ReturnType<typeof gwWatch>) {
    render(<App gateway={gateway} />)
    await fileMenu('打开项目...')
    await screen.findAllByText('雾港')
  }

  // 信号 → 等 200ms 防抖 + rescan 的 await 链跑完（沿用本文件既有的真实定时器防抖等待惯例）。
  async function fireAndFlush(watchHook: { fire?: () => void }) {
    watchHook.fire?.()
    await new Promise((r) => setTimeout(r, 400))
  }

  it('外部改干净文件 → 编辑器内容静默刷新', async () => {
    const watchHook: { fire?: () => void } = {}
    const gateway = gwWatch(watchHook)
    await openProject(gateway)
    await waitFor(() => expect(editorValue()).toContain('一段可编辑的正文'))
    await gateway.writeFile('/proj', 'main.kin', '=== 新 ===\n新内容。\n-> END\n')
    await fireAndFlush(watchHook)
    await waitFor(() => expect(editorValue()).toContain('=== 新 ==='))
    expect(screen.queryByTestId('sync-banner')).toBeNull()
  })

  it('外部改脏文件 → 冲突 banner 出现；「载入磁盘版本」换内容；「保留我的版本」收起并保脏', async () => {
    const watchHook: { fire?: () => void } = {}
    const gateway = gwWatch(watchHook)
    await openProject(gateway)
    await typeInEditor('我的未保存改动', true)
    await gateway.writeFile('/proj', 'main.kin', '=== 磁盘新版 ===\n外部改的内容。\n-> END\n')
    await fireAndFlush(watchHook)
    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText('此文件在磁盘上已被外部修改')).toBeInTheDocument()
    await userEvent.click(within(banner).getByRole('button', { name: '载入磁盘版本' }))
    await waitFor(() => expect(editorValue()).toContain('磁盘新版'))
    expect(screen.queryByTestId('sync-banner')).toBeNull()

    // 重做一轮冲突：再次弄脏 + 外部再改
    await typeInEditor('第二次未保存改动', true)
    await gateway.writeFile('/proj', 'main.kin', '=== 磁盘再改 ===\n再一次外部修改。\n-> END\n')
    await fireAndFlush(watchHook)
    const banner2 = await screen.findByRole('alert')
    await userEvent.click(within(banner2).getByRole('button', { name: '保留我的版本' }))
    expect(screen.queryByTestId('sync-banner')).toBeNull()
    expect(editorValue()).toContain('第二次未保存改动')
    expect(document.querySelector('.tab-dirty')).not.toBeNull()
  })

  it('外部删除脏文件 → tab 保留 + 删除 banner；Ctrl+S 重建文件', async () => {
    const watchHook: { fire?: () => void } = {}
    const gateway = gwWatch(watchHook)
    await openProject(gateway)
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText('other.kin'))
    await waitFor(() => expect(editorValue()).toContain('这里是一段测试文本'))
    await typeInEditor('未保存的改动', true)
    await gateway.deletePath('/proj', 'other.kin')
    await fireAndFlush(watchHook)
    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText('此文件已从磁盘删除——保存（Ctrl+S）可在原位置重建')).toBeInTheDocument()
    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getByText('other.kin')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(screen.queryByTestId('sync-banner')).toBeNull())
    const explorerAfter = await screen.findByRole('navigation', { name: '资源管理器' })
    expect(within(explorerAfter).getByText('other.kin')).toBeInTheDocument()
  })

  it('外部删除干净文件 → tab 关闭、文件树移除', async () => {
    const watchHook: { fire?: () => void } = {}
    const gateway = gwWatch(watchHook)
    await openProject(gateway)
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await userEvent.click(within(explorer).getByText('other.kin'))
    await waitFor(() => expect(editorValue()).toContain('这里是一段测试文本'))
    await gateway.deletePath('/proj', 'other.kin')
    await fireAndFlush(watchHook)
    await waitFor(() => expect(screen.queryByText('other.kin')).toBeNull())
  })

  it('外部新增 .kin → 文件树出现新条目', async () => {
    const watchHook: { fire?: () => void } = {}
    const gateway = gwWatch(watchHook)
    await openProject(gateway)
    await gateway.writeFile('/proj', 'new.kin', '=== 新文件 ===\n刚新增的文件。\n-> END\n')
    await fireAndFlush(watchHook)
    const explorer = await screen.findByRole('navigation', { name: '资源管理器' })
    await waitFor(() => expect(within(explorer).getByText('new.kin')).toBeInTheDocument())
  })
})
