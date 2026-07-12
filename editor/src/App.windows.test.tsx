import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { createMemoryGateway, type MemoryGatewayInit } from './files/memoryGateway'
import type { WindowMode } from './files/gateway'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  localStorage.clear()
})

const MANIFEST = JSON.stringify({ name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
const MAIN = '开场。\n-> END\n'
const PROJECT_FILES = { '/proj/kiny.json': MANIFEST, '/proj/main.kin': MAIN }

function makeGw(over: Partial<MemoryGatewayInit> & { windowMode?: WindowMode } = {}) {
  const windowSink: string[] = []
  const gateway = createMemoryGateway({
    pickedDir: '/proj',
    files: PROJECT_FILES,
    windowSink,
    ...over,
  })
  return { gateway, windowSink }
}

describe('memoryGateway 窗口角色（桩）', () => {
  it('currentWindowMode / currentWindowProject 缺省 null（web / SPA）', () => {
    const gw = createMemoryGateway({ files: {} })
    expect(gw.currentWindowMode()).toBeNull()
    expect(gw.currentWindowProject()).toBeNull()
  })
  it('注入 windowMode / windowProject 被如实返回', () => {
    const gw = createMemoryGateway({ files: {}, windowMode: 'editor', windowProject: '/proj' })
    expect(gw.currentWindowMode()).toBe('editor')
    expect(gw.currentWindowProject()).toBe('/proj')
  })
})

describe('App 窗口分流（模型 A · 互斥交接）', () => {
  it('启动窗（launch）：渲染 LaunchScreen；点「打开项目」→ 开编辑窗 + 关本窗（不就地载入）', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'launch', projectFilePick: '/proj' })
    render(<App gateway={gateway} />)
    // 启动窗只渲染 LaunchScreen（无 workbench、无菜单栏）
    expect(screen.getByRole('button', { name: /打开项目/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '文件' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /打开项目/ }))
    // 交接：开编辑窗（带 dir）→ 关启动窗；不在本窗进 workbench
    await waitFor(() => expect(windowSink).toEqual(['openEditor:/proj', 'close']))
    expect(screen.queryByRole('menuitem', { name: '文件' })).toBeNull()
  })

  it('启动窗：冷启动待打开路径（launchProject）→ 直接开编辑窗 + 关本窗（不经启动窗停留）', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'launch', launchProject: '/proj/雾港.kiw' })
    render(<App gateway={gateway} />)
    await waitFor(() => expect(windowSink).toEqual(['openEditor:/proj', 'close']))
  })

  it('编辑窗（editor）：从 ?project 载入项目 → 渲染 workbench', async () => {
    const { gateway } = makeGw({ windowMode: 'editor', windowProject: '/proj' })
    render(<App gateway={gateway} />)
    // 编辑窗载入后进 workbench，菜单栏 + 项目名出现
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('menuitem', { name: '文件' })).toBeInTheDocument()
  })

  it('编辑窗：无 ?project（异常）→ 回退开启动窗 + 关本窗（不留空编辑窗）', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'editor', windowProject: null })
    render(<App gateway={gateway} />)
    await waitFor(() => expect(windowSink).toEqual(['openLaunch', 'close']))
  })

  it('编辑窗：?project 载入失败 → 回退开启动窗 + 关本窗', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'editor', windowProject: '/missing', files: {} })
    render(<App gateway={gateway} />)
    await waitFor(() => expect(windowSink).toEqual(['openLaunch', 'close']))
  })

  it('编辑窗：「关闭项目」→ 开启动窗 + 关本编辑窗（不在窗内回启动页）', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'editor', windowProject: '/proj' })
    render(<App gateway={gateway} />)
    await screen.findByRole('menuitem', { name: '文件' })
    await userEvent.click(screen.getByRole('menuitem', { name: '文件' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '关闭项目' }))
    await waitFor(() => expect(windowSink).toEqual(['openLaunch', 'close']))
  })

  it('编辑窗：boot 载入失败且开启动窗又失败 → 不关本窗（保留过渡占位，避免零窗口）', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'editor', windowProject: '/missing', files: {}, windowOpenFails: true })
    render(<App gateway={gateway} />)
    // 尝试开启动窗失败 → 不再 close（无 'close'）；仍显示过渡占位
    await waitFor(() => expect(windowSink).toEqual(['openLaunch:FAIL']))
    expect(screen.getByText('正在打开项目…')).toBeInTheDocument()
  })

  it('编辑窗：「关闭项目」开启动窗失败 → 不关本编辑窗（避免零窗口）', async () => {
    const { gateway, windowSink } = makeGw({ windowMode: 'editor', windowProject: '/proj', windowOpenFails: true })
    render(<App gateway={gateway} />)
    await screen.findByRole('menuitem', { name: '文件' })
    await userEvent.click(screen.getByRole('menuitem', { name: '文件' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '关闭项目' }))
    await waitFor(() => expect(windowSink).toEqual(['openLaunch:FAIL']))
    // 未关本窗：仍在 workbench
    expect(screen.getByRole('menuitem', { name: '文件' })).toBeInTheDocument()
  })

  it('启动窗：按屏幕分辨率定尺寸（setWindowSize 收到 computeLaunchSize 结果）', async () => {
    const sizeSink: { width: number; height: number }[] = []
    const gateway = createMemoryGateway({
      files: PROJECT_FILES, windowMode: 'launch', monitorSize: { width: 1920, height: 1080 }, sizeSink,
    })
    render(<App gateway={gateway} />)
    await waitFor(() => expect(sizeSink).toEqual([{ width: 998, height: 691 }]))
  })

  it('启动窗：取不到屏幕分辨率 → 回落默认 LAUNCH_WINDOW（880×620）', async () => {
    const sizeSink: { width: number; height: number }[] = []
    const gateway = createMemoryGateway({
      files: PROJECT_FILES, windowMode: 'launch', monitorSize: null, sizeSink,
    })
    render(<App gateway={gateway} />)
    await waitFor(() => expect(sizeSink).toEqual([{ width: 880, height: 620 }]))
  })

  it('编辑窗 / web：不按分辨率定启动窗尺寸（launch 专属）', async () => {
    const sizeSink: { width: number; height: number }[] = []
    const editorGw = createMemoryGateway({ files: PROJECT_FILES, windowMode: 'editor', windowProject: '/proj', monitorSize: { width: 1920, height: 1080 }, sizeSink })
    render(<App gateway={editorGw} />)
    await screen.findByRole('menuitem', { name: '文件' })
    expect(sizeSink).toEqual([]) // 编辑窗不触发启动窗定尺寸
  })

  it('web / SPA（windowMode=null）：打开项目就地进 workbench，不触发窗口交接', async () => {
    const { gateway, windowSink } = makeGw({ projectFilePick: '/proj' }) // windowMode 缺省 null
    render(<App gateway={gateway} />)
    await userEvent.click(screen.getByRole('button', { name: /打开项目/ }))
    expect((await screen.findAllByText('雾港')).length).toBeGreaterThan(0) // 就地进 workbench
    expect(windowSink).toEqual([]) // 无窗口交接
  })
})
