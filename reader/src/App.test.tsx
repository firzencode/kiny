import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const listLibrary = vi.fn()
const importKip = vi.fn()
const deleteStory = vi.fn()
const pickKipFile = vi.fn()
const loadStory = vi.fn()
const ask = vi.fn()
const readSave = vi.fn()
const writeSave = vi.fn()
const listSaves = vi.fn()
const deleteSave = vi.fn()
const getOpenedUris = vi.fn()
const subscribeOpened = vi.fn()

vi.mock('./library/store', () => ({
  listLibrary: (...a: unknown[]) => listLibrary(...a),
  importKip: (...a: unknown[]) => importKip(...a),
  deleteStory: (...a: unknown[]) => deleteStory(...a),
  pickKipFile: (...a: unknown[]) => pickKipFile(...a),
}))
vi.mock('./reading/loadStory', () => ({ loadStory: (...a: unknown[]) => loadStory(...a) }))
vi.mock('./library/importDrop', () => ({ subscribeKipDrop: () => Promise.resolve(() => {}) }))
vi.mock('./library/openedIntent', () => ({
  getOpenedUris: (...a: unknown[]) => getOpenedUris(...a),
  subscribeOpened: (...a: unknown[]) => subscribeOpened(...a),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: (...a: unknown[]) => ask(...a) }))
vi.mock('./saves/store', () => ({
  readSave: (...a: unknown[]) => readSave(...a),
  writeSave: (...a: unknown[]) => writeSave(...a),
  listSaves: (...a: unknown[]) => listSaves(...a),
  deleteSave: (...a: unknown[]) => deleteSave(...a),
  genSaveId: () => 'cafe',
}))

import { App } from './App'
import { advance, choose, initialState, type ResolveAsset } from '@kiny/player'
import { assembleStory } from './reading/assembleStory'
import { captureSave } from './saves/snapshot'
import { AUTO_SAVE_ID } from './saves/types'

const ITEM = { id: 'a', dir: '/l/a', name: '雾港之夜', author: '佚名' }
const KIN = '=== 开场 ===\n你站在门口。\n-> END\n'
const MANIFEST = JSON.stringify({ name: '雾港之夜', version: '1', engine: '0.1.0', entry: 'main.kin' })
const resolve: ResolveAsset = (n) => n

beforeEach(() => {
  [listLibrary, importKip, deleteStory, pickKipFile, loadStory, ask, readSave, writeSave, listSaves, deleteSave, getOpenedUris, subscribeOpened].forEach((m) => m.mockReset())
  readSave.mockResolvedValue(null) // 默认无续读存档
  writeSave.mockResolvedValue(undefined)
  listSaves.mockResolvedValue([])
  deleteSave.mockResolvedValue(undefined)
  getOpenedUris.mockResolvedValue([]) // 默认无「打开 .kip」意图
  subscribeOpened.mockResolvedValue(() => {})
})

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

  it('冷启动被「打开 .kip」意图拉起 → 导入并入库', async () => {
    listLibrary.mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM])
    getOpenedUris.mockResolvedValue(['content://kip/1'])
    importKip.mockResolvedValue(ITEM)
    render(<App />)
    await waitFor(() => expect(importKip).toHaveBeenCalledWith('content://kip/1'))
    expect(await screen.findByText('雾港之夜')).toBeInTheDocument()
  })

  it('一批意图 URI 中某个失败 → 其余照样导入、错误提示出现', async () => {
    const ITEM2 = { id: 'b', dir: '/l/b', name: '灯塔守望', author: '某人' }
    listLibrary.mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM, ITEM2])
    getOpenedUris.mockResolvedValue(['content://ok/1', 'content://bad/2', 'content://ok/3'])
    importKip
      .mockResolvedValueOnce(ITEM) // 1 成功
      .mockRejectedValueOnce(new Error('坏包')) // 2 失败
      .mockResolvedValueOnce(ITEM2) // 3 仍尝试并成功
    render(<App />)
    await waitFor(() => expect(importKip).toHaveBeenCalledTimes(3))
    expect(importKip).toHaveBeenNthCalledWith(1, 'content://ok/1')
    expect(importKip).toHaveBeenNthCalledWith(2, 'content://bad/2')
    expect(importKip).toHaveBeenNthCalledWith(3, 'content://ok/3')
    expect(await screen.findByText('灯塔守望')).toBeInTheDocument() // 成功的入库
    expect(screen.getByText('坏包')).toBeInTheDocument() // 失败提示
  })

  it('运行中收到「分享 .kip」意图 → 导入并入库', async () => {
    listLibrary.mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM])
    importKip.mockResolvedValue(ITEM)
    let emit: ((uris: string[]) => void) | undefined
    subscribeOpened.mockImplementation((cb: (uris: string[]) => void) => {
      emit = cb
      return Promise.resolve(() => {})
    })
    render(<App />)
    await waitFor(() => expect(emit).toBeDefined())
    emit!(['content://kip/2'])
    await waitFor(() => expect(importKip).toHaveBeenCalledWith('content://kip/2'))
    expect(await screen.findByText('雾港之夜')).toBeInTheDocument()
  })

  const KIN2 = '=== 开场 ===\n你站在门口。\n* [推门进去] -> 里屋\n* [离开] -> END\n=== 里屋 ===\n屋里很暖。\n-> END\n'
  // 构造一条「进了里屋」的自动续读存档。
  function autoSaveInRoom() {
    const out = assembleStory(MANIFEST, new Map([['main.kin', KIN2]]), 1)
    if (!out.ok) throw new Error(out.message)
    let play = advance(out.story, initialState, resolve).state
    play = choose(out.story, play, play.choices[0].index, resolve).state // 进里屋
    return captureSave(out.story, play, 'auto', AUTO_SAVE_ID, 1)
  }
  function freshKin2() {
    const out = assembleStory(MANIFEST, new Map([['main.kin', KIN2]]), 1)
    if (!out.ok) throw new Error(out.message)
    return out
  }

  it('有自动存档 → 书架显「继续」→ 点继续恢复到存点', async () => {
    listLibrary.mockResolvedValue([ITEM])
    readSave.mockResolvedValue(autoSaveInRoom())
    const fresh = freshKin2()
    loadStory.mockResolvedValue({ ok: true, story: fresh.story, program: fresh.program, resolveAsset: resolve, title: '雾港之夜' })
    render(<App />)
    await userEvent.click(await screen.findByText('▸ 继续'))
    expect(await screen.findByText('屋里很暖。')).toBeInTheDocument() // 回到里屋存点
  })

  it('存档指纹失配 → 从头开始并提示', async () => {
    listLibrary.mockResolvedValue([ITEM])
    readSave.mockResolvedValue(autoSaveInRoom())
    // 用改过的故事重装（指纹变）→ restore 失配
    const changed = assembleStory(MANIFEST, new Map([['main.kin', KIN2 + '=== 新增 ===\n额外。\n-> END\n']]), 1)
    if (!changed.ok) throw new Error(changed.message)
    loadStory.mockResolvedValue({ ok: true, story: changed.story, program: changed.program, resolveAsset: resolve, title: '雾港之夜' })
    render(<App />)
    await userEvent.click(await screen.findByText('▸ 继续'))
    expect(await screen.findByText('你站在门口。')).toBeInTheDocument() // 从开场起
    expect(screen.getByText(/已从头开始/)).toBeInTheDocument()
  })
})
