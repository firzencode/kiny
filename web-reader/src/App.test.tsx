import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import { App } from './App'

vi.mock('./load/loadDemo')
import { loadDemo } from './load/loadDemo'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

function realStory() {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', '开场白。\n* [继续] -> 尾\n=== 尾 ===\n结束语。\n-> END\n']]),
  )
  if (!res.ok) throw new Error('load failed')
  const { program } = analyze(res.files)
  const start = resolveStart(program!, res.entry)!
  return createStory(program!, { start })
}

describe('App', () => {
  it('加载成功 → StartGate → 点开始进入故事', async () => {
    vi.mocked(loadDemo).mockResolvedValue({
      ok: true, value: { story: realStory(), assetBase: 'demo/', title: '雾港之夜' },
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(screen.getByText('开场白。')).toBeInTheDocument()
  })

  it('加载失败 → 显示错误消息', async () => {
    vi.mocked(loadDemo).mockResolvedValue({ ok: false, message: '加载失败：缺少 kiny.json' })
    render(<App />)
    await waitFor(() => expect(screen.getByText(/加载失败/)).toBeInTheDocument())
  })
})
