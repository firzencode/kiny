import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const listLibrary = vi.fn()
const importKip = vi.fn()
const deleteStory = vi.fn()
const pickKipFile = vi.fn()
const loadStory = vi.fn()
const ask = vi.fn()

vi.mock('./library/store', () => ({
  listLibrary: (...a: unknown[]) => listLibrary(...a),
  importKip: (...a: unknown[]) => importKip(...a),
  deleteStory: (...a: unknown[]) => deleteStory(...a),
  pickKipFile: (...a: unknown[]) => pickKipFile(...a),
}))
vi.mock('./reading/loadStory', () => ({ loadStory: (...a: unknown[]) => loadStory(...a) }))
vi.mock('./library/importDrop', () => ({ subscribeKipDrop: () => Promise.resolve(() => {}) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: (...a: unknown[]) => ask(...a) }))

import { App } from './App'
import { assembleStory } from './reading/assembleStory'

const ITEM = { id: 'a', dir: '/l/a', name: '雾港之夜', author: '佚名' }
const KIN = '=== 开场 ===\n你站在门口。\n-> END\n'
const MANIFEST = JSON.stringify({ name: '雾港之夜', version: '1', engine: '0.1.0', entry: 'main.kin' })

beforeEach(() => { [listLibrary, importKip, deleteStory, pickKipFile, loadStory, ask].forEach((m) => m.mockReset()) })

describe('App', () => {
  it('开屏加载书架并显示条目', async () => {
    listLibrary.mockResolvedValue([ITEM])
    render(<App />)
    expect(await screen.findByText('雾港之夜')).toBeInTheDocument()
  })

  it('点条目 → loadStory → 进阅读屏', async () => {
    listLibrary.mockResolvedValue([ITEM])
    const out = assembleStory(MANIFEST, new Map([['main.kin', KIN]]), 1)
    if (!out.ok) throw new Error(out.message)
    loadStory.mockResolvedValue({ ok: true, story: out.story, resolveAsset: (n: string) => n, title: '雾港之夜' })
    render(<App />)
    await userEvent.click(await screen.findByText('雾港之夜'))
    expect(await screen.findByText('你站在门口。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /书架/ })).toBeInTheDocument()
  })

  it('导入按钮 → 选文件 → importKip → 刷新', async () => {
    listLibrary.mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM])
    pickKipFile.mockResolvedValue('/d/x.kip')
    importKip.mockResolvedValue(ITEM)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /导入故事/ }))
    await waitFor(() => expect(importKip).toHaveBeenCalledWith('/d/x.kip'))
    expect(await screen.findByText('雾港之夜')).toBeInTheDocument()
  })
})
