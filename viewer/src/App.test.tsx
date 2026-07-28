import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import { App } from './App'

vi.mock('./load/loadStory')
import { loadStory } from './load/loadStory'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  localStorage.clear() // 阅读进度隔离，避免测试间残留存档相互干扰
})

import type { LoadedStory } from './load/loadStory'
import { progressKey } from './load/progress'

function realLoaded(): LoadedStory {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', '开场白。\n* [继续] -> 尾\n=== 尾 ===\n结束语。\n-> END\n']]),
  )
  if (!res.ok) throw new Error('load failed')
  const { program } = analyze(res.files)
  const start = resolveStart(program!, res.entry)!
  const seed = 12345
  return { story: createStory(program!, { start, seed }), assetBase: 'demo/', projectCss: '', title: '雾港之夜', version: '1.0.0', program: program!, start, seed }
}

describe('App', () => {
  it('加载成功 → StartGate → 点开始进入故事', async () => {
    vi.mocked(loadStory).mockResolvedValue({
      ok: true, value: realLoaded(),
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(screen.getByText('开场白。')).toBeInTheDocument()
  })

  it('加载成功后页面标题置为故事名', async () => {
    vi.mocked(loadStory).mockResolvedValue({
      ok: true, value: realLoaded(),
    })
    render(<App />)
    await waitFor(() => expect(document.title).toBe('雾港之夜'))
  })

  it('加载失败 → 显示错误消息', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: false, message: '加载失败：缺少 kiny.json' })
    render(<App />)
    await waitFor(() => expect(screen.getByText(/加载失败/)).toBeInTheDocument())
  })

  it('loadStory promise reject → 显示错误而非永久卡「加载中……」', async () => {
    vi.mocked(loadStory).mockRejectedValue(new TypeError('Object.entries called on undefined'))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/出错|失败/)).toBeInTheDocument())
    expect(screen.queryByText('加载中……')).not.toBeInTheDocument()
  })

  // 阅读进度持久化（X5）——保位重放恢复 / 分歧回退。
  it('有存档 → 点开始保位重放恢复到上次暂停点（选过「继续」→ 直达尾节点）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    localStorage.setItem(progressKey('雾港之夜', '1.0.0'), JSON.stringify({ seed: 12345, seq: [{ kind: 'choice', pos: 0 }] }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await waitFor(() => expect(screen.getAllByText('结束语。').length).toBeGreaterThan(0))
  })

  it('存档与当前故事分歧（选项位置越界）→ 从头开始并提示', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    localStorage.setItem(progressKey('雾港之夜', '1.0.0'), JSON.stringify({ seed: 12345, seq: [{ kind: 'choice', pos: 9 }] }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await waitFor(() => expect(screen.getByText(/已从头开始/)).toBeInTheDocument())
    // 从头：开场白重新出现，存档被清（回退后重存空序列）
    expect(screen.getAllByText('开场白。').length).toBeGreaterThan(0)
  })

  it('重新开始后交互序列从头记录（不带旧 seq，防刷新恢复错位）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    const key = progressKey('雾港之夜', '1.0.0')
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    const before = JSON.parse(localStorage.getItem(key)!)
    expect(before.seq).toHaveLength(1)
    // 重新开始 → 再选一次：序列应是新一局的（长度 1），而非旧+新（长度 2）。
    await userEvent.click(screen.getByRole('button', { name: '重新开始' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    const after = JSON.parse(localStorage.getItem(key)!)
    expect(after.seq).toHaveLength(1)
    expect(after.seed).not.toBe(before.seed) // 新 run 用新 seed
  })
})
