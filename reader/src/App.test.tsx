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
const subscribeKipDrop = vi.fn()
const storiesWithAutoSave = vi.fn()

vi.mock('./library/store', () => ({
  listLibrary: (...a: unknown[]) => listLibrary(...a),
  importKip: (...a: unknown[]) => importKip(...a),
  deleteStory: (...a: unknown[]) => deleteStory(...a),
  pickKipFile: (...a: unknown[]) => pickKipFile(...a),
}))
vi.mock('./reading/loadStory', () => ({ loadStory: (...a: unknown[]) => loadStory(...a) }))
vi.mock('./library/importDrop', () => ({ subscribeKipDrop: (...a: unknown[]) => subscribeKipDrop(...a) }))
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
  storiesWithAutoSave: (...a: unknown[]) => storiesWithAutoSave(...a),
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
  [listLibrary, importKip, deleteStory, pickKipFile, loadStory, ask, readSave, writeSave, listSaves, deleteSave, getOpenedUris, subscribeOpened, subscribeKipDrop, storiesWithAutoSave].forEach((m) => m.mockReset())
  readSave.mockResolvedValue(null) // 默认无续读存档
  writeSave.mockResolvedValue(undefined)
  listSaves.mockResolvedValue([])
  deleteSave.mockResolvedValue(undefined)
  storiesWithAutoSave.mockResolvedValue([]) // 默认无书可续读（书架批量探测 Q3）
  getOpenedUris.mockResolvedValue([]) // 默认无「打开 .kip」意图
  subscribeOpened.mockResolvedValue(() => {})
  subscribeKipDrop.mockResolvedValue(() => {})
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

  it('Tauri 字符串 rejection 透传具体诊断文案（invoke 失败 reject 的是 string 非 Error）', async () => {
    listLibrary.mockResolvedValue([])
    pickKipFile.mockResolvedValue('/d/x.kip')
    importKip.mockRejectedValueOnce('不是合法的 zip / .kip：坏包')
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /导入故事/ }))
    expect(await screen.findByText('不是合法的 zip / .kip：坏包')).toBeInTheDocument()
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

  it('运行中收到「分享 .kip」意图 → 经 take 口重拉并导入入库', async () => {
    listLibrary.mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM])
    importKip.mockResolvedValue(ITEM)
    // 冷启动无 pending；热 emit 触发的重拉才取到该 uri（B2：热路径经 getOpenedUris/take，非 emit payload）。
    getOpenedUris.mockResolvedValueOnce([]).mockResolvedValueOnce(['content://kip/2'])
    let emit: ((uris: string[]) => void) | undefined
    subscribeOpened.mockImplementation((cb: (uris: string[]) => void) => {
      emit = cb
      return Promise.resolve(() => {})
    })
    render(<App />)
    await waitFor(() => expect(emit).toBeDefined())
    emit!(['content://kip/2']) // emit payload 现仅作「来重拉」信号
    await waitFor(() => expect(importKip).toHaveBeenCalledWith('content://kip/2'))
    expect(await screen.findByText('雾港之夜')).toBeInTheDocument()
  })

  it('热启动导入后 activity 重建 remount 不重复导入（T068：热路径经 take 排空 state）', async () => {
    listLibrary.mockResolvedValue([])
    importKip.mockResolvedValue(ITEM)
    // 模拟 Rust opened_urls 的 take 语义：mount1 冷启动无 pending；热 emit 重拉取到该 uri（并清空）；
    // remount 冷启动再取即为空。旧代码（热路径用 emit payload、不排空 state）下 remount 会再取到 → 重导。
    getOpenedUris
      .mockResolvedValueOnce([]) // mount1 冷启动
      .mockResolvedValueOnce(['content://kip/3']) // 热 emit 重拉：取到 + 清空
      .mockResolvedValue([]) // remount 冷启动：已清空
    let emit: ((uris: string[]) => void) | undefined
    subscribeOpened.mockImplementation((cb: (uris: string[]) => void) => {
      emit = cb
      return Promise.resolve(() => {})
    })
    const { unmount } = render(<App />)
    await waitFor(() => expect(emit).toBeDefined())
    emit!(['content://kip/3'])
    await waitFor(() => expect(importKip).toHaveBeenCalledTimes(1))
    unmount()
    render(<App />) // Android 回收重建 activity → App remount
    await waitFor(() => expect(getOpenedUris).toHaveBeenCalledTimes(3)) // remount 的冷启动确实重取过
    expect(importKip).toHaveBeenCalledTimes(1) // 仍只 1 次，无重复导入
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
    storiesWithAutoSave.mockResolvedValue([ITEM.id]) // 书架批量探测报此书可续读
    readSave.mockResolvedValue(autoSaveInRoom()) // 点「继续」时据此恢复存点
    const fresh = freshKin2()
    loadStory.mockResolvedValue({ ok: true, story: fresh.story, program: fresh.program, resolveAsset: resolve, title: '雾港之夜' })
    render(<App />)
    await userEvent.click(await screen.findByText('▸ 继续'))
    expect(await screen.findByText('屋里很暖。')).toBeInTheDocument() // 回到里屋存点
  })

  it('存档指纹失配 → 从头开始并提示', async () => {
    listLibrary.mockResolvedValue([ITEM])
    storiesWithAutoSave.mockResolvedValue([ITEM.id]) // 书架批量探测报此书可续读
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

  // B2：桌面多文件拖放 → 整批逐个导入（不再只取第一个）。
  it('多文件拖放 → 整批导入', async () => {
    const ITEM2 = { id: 'b', dir: '/l/b', name: '灯塔守望', author: '某人' }
    listLibrary.mockResolvedValueOnce([]).mockResolvedValueOnce([ITEM, ITEM2])
    let drop: ((paths: string[]) => void) | undefined
    subscribeKipDrop.mockImplementation((cb: (paths: string[]) => void) => {
      drop = cb
      return Promise.resolve(() => {})
    })
    importKip.mockResolvedValueOnce(ITEM).mockResolvedValueOnce(ITEM2)
    render(<App />)
    await waitFor(() => expect(drop).toBeDefined())
    drop!(['/d/a.kip', '/d/b.kip'])
    await waitFor(() => expect(importKip).toHaveBeenCalledTimes(2))
    expect(importKip).toHaveBeenNthCalledWith(1, '/d/a.kip')
    expect(importKip).toHaveBeenNthCalledWith(2, '/d/b.kip')
    expect(await screen.findByText('灯塔守望')).toBeInTheDocument()
  })

  // B9：导入进行中再次触发拖放被互斥忽略（不并发导入）。
  it('导入进行中的第二次拖放被忽略（互斥）', async () => {
    listLibrary.mockResolvedValue([])
    let drop: ((paths: string[]) => void) | undefined
    subscribeKipDrop.mockImplementation((cb: (paths: string[]) => void) => {
      drop = cb
      return Promise.resolve(() => {})
    })
    // 首次导入挂起（受控 resolve），期间发起第二次拖放。
    let release: (() => void) | undefined
    importKip.mockImplementation(() => new Promise<typeof ITEM>((res) => { release = () => res(ITEM) }))
    render(<App />)
    await waitFor(() => expect(drop).toBeDefined())
    drop!(['/d/first.kip'])
    await waitFor(() => expect(importKip).toHaveBeenCalledTimes(1))
    drop!(['/d/second.kip']) // busy 中 → 应被忽略
    await Promise.resolve()
    expect(importKip).toHaveBeenCalledTimes(1) // 第二次没有发起
    release!() // 放行首次，收尾
    await waitFor(() => expect(importKip).toHaveBeenCalledTimes(1))
  })

  // Q3：书架批量探测——仅探测集合内的书显「继续」，其余显「开始」（一次 IPC 定全部）。
  it('批量探测只让有 auto 存档的书显「继续」', async () => {
    const ITEM2 = { id: 'b', dir: '/l/b', name: '灯塔守望', author: '某人' }
    listLibrary.mockResolvedValue([ITEM, ITEM2])
    storiesWithAutoSave.mockResolvedValue([ITEM2.id]) // 只有「灯塔守望」可续读
    render(<App />)
    await screen.findByText('灯塔守望')
    // 有 auto 的书出现「▸ 继续」，且全书架仅一处（另一本无）。
    expect(screen.getByText('▸ 继续')).toBeInTheDocument()
    expect(screen.getAllByText('▸ 继续')).toHaveLength(1)
    expect(storiesWithAutoSave).toHaveBeenCalledTimes(1) // 一次 IPC 定全部，非逐本
  })
})
