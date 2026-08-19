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
import { savesKey, AUTO_SAVE_ID, listSaves, type ViewerSave } from './load/saves'

function realLoaded(): LoadedStory {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', '开场白。\n* [继续] -> 尾\n=== 尾 ===\n结束语。\n-> END\n']]),
  )
  if (!res.ok) throw new Error('load failed')
  const { program } = analyze(res.files)
  const start = resolveStart(program!, res.entry)!
  const seed = 12345
  return { story: createStory(program!, { start, seed }), assetBase: 'demo/', projectCss: '', characters: new Map(), title: '雾港之夜', version: '1.0.0', id: undefined, program: program!, start, seed }
}

/**
 * 专供 auto 档 label 滞后测试：选完第一个选项后停在「另一个选项前」而非直接结束——
 * 这样才能断言 label 是「选择之后」的旁白文本，而不是巧合命中 previewLabel 的「（已结束）」特判分支。
 */
function loadedWithMidChoice(): LoadedStory {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', '开场白。\n* [继续] -> 中段\n=== 中段 ===\n中段旁白。\n* [再选] -> 尾\n=== 尾 ===\n结束语。\n-> END\n']]),
  )
  if (!res.ok) throw new Error('load failed')
  const { program } = analyze(res.files)
  const start = resolveStart(program!, res.entry)!
  const seed = 12345
  return { story: createStory(program!, { start, seed }), assetBase: 'demo/', projectCss: '', characters: new Map(), title: '雾港之夜', version: '1.0.0', id: undefined, program: program!, start, seed }
}

/**
 * 触发脚本运行时错误：`~let o = null` 前导块会让 resolveStart 落到立即结束的 opening knot，
 * 故显式以 `起` 为入口（同 player replay.test 的 BOOM 用例）。[继续] 这步本身不出错，
 * choose 后 advance 进「雷」节点插值 `o.x`（o=null）才抛 RuntimeError，被 driver 接成 state.error。
 */
function loadedWithError(): LoadedStory {
  const kin = ['~ let o = null', '=== 起 ===', '安全。', '* [继续] -> 雷', '=== 雷 ===', '值{o.x}', '-> END'].join('\n')
  const res = loadProjectFromFiles(
    JSON.stringify({ name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load failed')
  const { program } = analyze(res.files)
  const start = '起'
  const seed = 12345
  return { story: createStory(program!, { start, seed }), assetBase: 'demo/', projectCss: '', characters: new Map(), title: '雾港之夜', version: '1.0.0', id: undefined, program: program!, start, seed }
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
})

const KEY = savesKey(undefined, '雾港之夜')

function putSave(save: Partial<ViewerSave> & Pick<ViewerSave, 'id' | 'kind' | 'seed' | 'seq'>) {
  const full: ViewerSave = { meta: { timestamp: 1_700_000_000_000, label: '开场白。' }, ...save } as ViewerSave
  localStorage.setItem(KEY, JSON.stringify([full]))
}

describe('多存档', () => {
  it('有 auto 档 → 点开始保位重放恢复到上次暂停点', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    putSave({ id: AUTO_SAVE_ID, kind: 'auto', seed: 12345, seq: [{ kind: 'choice', pos: 0, text: '继续' }] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await waitFor(() => expect(screen.getAllByText('结束语。').length).toBeGreaterThan(0))
  })

  it('作品带稳定 id：存档落 id 键，故事名旧键里的进度被复制过来接着读', async () => {
    const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: { ...realLoaded(), id: ID } })
    // 作者补上 id 重新导出前，读者的进度存在按故事名分桶的旧键下
    putSave({ id: AUTO_SAVE_ID, kind: 'auto', seed: 12345, seq: [{ kind: 'choice', pos: 0, text: '继续' }] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await waitFor(() => expect(screen.getAllByText('结束语。').length).toBeGreaterThan(0))
    expect(listSaves(savesKey(ID, '雾港之夜'))).toHaveLength(1)
    expect(listSaves(KEY)).toHaveLength(1) // 旧键保留，同名的另一份作品日后也要从这里复制
  })

  it('auto 档重放分歧 → 从头开始并提示（存档不静默复用）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    putSave({ id: AUTO_SAVE_ID, kind: 'auto', seed: 12345, seq: [{ kind: 'choice', pos: 9 }] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await waitFor(() => expect(screen.getByText(/已从头开始/)).toBeInTheDocument())
    expect(screen.getAllByText('开场白。').length).toBeGreaterThan(0)
  })

  it('点选项写 auto 档；「＋ 存档当前进度」另写一条手动档', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    expect(listSaves(KEY).filter((s) => s.kind === 'auto')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 存档当前进度' }))
    const all = listSaves(KEY)
    expect(all.filter((s) => s.kind === 'manual')).toHaveLength(1)
    expect(all[0]!.id).toBe(AUTO_SAVE_ID) // auto 置顶
  })

  it('读手动档 → 回到该档位置，且不顶掉 auto 档', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    // 一条停在开场的手动档 + 一条已推进到尾的 auto 档
    localStorage.setItem(KEY, JSON.stringify([
      { id: AUTO_SAVE_ID, kind: 'auto', seed: 12345, seq: [{ kind: 'choice', pos: 0, text: '继续' }], meta: { timestamp: 2, label: '结束语。' } },
      { id: 'm1', kind: 'manual', seed: 12345, seq: [], meta: { timestamp: 1, label: '开场白。' } },
    ]))
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getAllByRole('button', { name: '读取' })[1]!) // 手动档那条
    // 回到开场：选项「继续」重新可点
    expect(await screen.findByRole('button', { name: '继续' })).toBeInTheDocument()
    // auto 档没被读档动作顶掉
    expect(listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)!.seq).toHaveLength(1)
  })

  it('读一条与当前故事分歧的存档 → 面板内报「故事已更新」且该档不被删', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    putSave({ id: 'm1', kind: 'manual', seed: 12345, seq: [{ kind: 'choice', pos: 9 }] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    // 开局无条件补一条 auto 档（钉住本次 run 的 seed），故此时面板有两行：auto 置顶、m1 在后。
    await userEvent.click(screen.getAllByRole('button', { name: '读取' })[1]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('该存档对应的故事已更新，无法读取此存档。')
    expect(listSaves(KEY).find((s) => s.id === 'm1')).toBeDefined()
  })

  it('删除一条存档', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    putSave({ id: 'm1', kind: 'manual', seed: 12345, seq: [] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    // 开局无条件补一条 auto 档，故面板有两行：auto 置顶、m1 在后——删的是 m1 那条，auto 留着。
    await userEvent.click(screen.getAllByRole('button', { name: '删除存档' })[1]!)
    await userEvent.click(screen.getByRole('button', { name: '确定删除?' }))
    await waitFor(() => {
      const remaining = listSaves(KEY)
      expect(remaining.find((s) => s.id === 'm1')).toBeUndefined()
      expect(remaining).toHaveLength(1) // 只剩 auto 档
    })
  })

  it('有手动档时开局也会建 auto 档（不因已有别的存档而跳过）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    putSave({ id: 'm1', kind: 'manual', seed: 12345, seq: [] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    // onStart 无条件写 auto：它钉住的是本次 run 的 seed（loadStory 的默认 seed 每次刷新都随机取，
    // 见 loadStory.ts），不写的话读者若在首次交互前刷新就会换到另一颗种子。
    await waitFor(() => expect(listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)).toBeDefined())
    expect(listSaves(KEY).find((s) => s.id === 'm1')).toBeDefined() // 手动档没被顶掉
  })

  it('auto 档的 label 描述选择之后的位置（不滞后一步）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: loadedWithMidChoice() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    // 选完「继续」后停在「中段」的新选项前。若 record() 仍在交互当帧读 pb.state 落 previewLabel，
    // 读到的是选择前那一帧，label 会错误地停在「开场白。」而不是「中段旁白。」。
    await waitFor(() => {
      const auto = listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)
      expect(auto?.meta.label).toBe('中段旁白。')
    })
  })

  it('存档写入失败 → toast 提示且不阻断阅读', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 存档当前进度' }))
    expect(await screen.findByText('存档失败，请稍后重试')).toBeInTheDocument()
    vi.restoreAllMocks()
    // 阅读没断：关掉面板仍能推进
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    expect(screen.getAllByText('结束语。').length).toBeGreaterThan(0)
  })

  it('旧键进度自动迁移为 auto 档', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    localStorage.setItem('kiny-progress:雾港之夜@1.0.0', JSON.stringify({ seed: 12345, seq: [{ kind: 'choice', pos: 0 }] }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await waitFor(() => expect(listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)).toBeDefined())
    expect(localStorage.getItem('kiny-progress:雾港之夜@1.0.0')).toBeNull()
  })

  // 控制器裁定保留：换局时 seqRef 必须随 story 重置，否则重开后首次交互把新 seed 与旧序列一起
  // 落盘、刷新会恢复到错位置（这条有真实缺陷史，见 PlayingView 的 useEffect([story]) 注释）。
  it('重新开始后交互序列从头记录（不带旧 seq，防刷新恢复错位）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    const before = listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)!
    expect(before.seq).toHaveLength(1)

    // 重新开始：auto 档立即归空、换新 seed（写档发生在 freshFrom，交互前）
    await userEvent.click(screen.getByRole('button', { name: '重新开始' }))
    const reset = listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)!
    expect(reset.seq).toHaveLength(0)
    expect(reset.seed).not.toBe(before.seed) // 新 run 用新 seed

    // 再选一次：序列应是新一局的（长度 1），而非旧+新（长度 2）——验 seqRef 真的随 story 重置。
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    const after = listSaves(KEY).find((s) => s.id === AUTO_SAVE_ID)!
    expect(after.seq).toHaveLength(1)
  })

  it('自动存档写入失败 → 提示「自动保存进度失败」，不再静默（措辞区别于手动存档）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    await userEvent.click(await screen.findByRole('button', { name: '继续' })) // 推进到下个暂停点，触发 auto 补写
    expect(await screen.findByText('自动保存进度失败')).toBeInTheDocument()
    expect(screen.queryByText('存档失败，请稍后重试')).not.toBeInTheDocument() // 不是手动存档的措辞
    vi.restoreAllMocks()
  })

  it('自动存档成功时不打扰读者（不弹提示）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' }))
    expect(screen.queryByText(/自动保存进度失败/)).not.toBeInTheDocument()
    expect(screen.queryByText('已存档')).not.toBeInTheDocument()
  })

  it('故事运行时出错后，手动存档被跳过——不是「写失败」，是「本就不该写」，两种提示都不出现', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: loadedWithError() })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(await screen.findByRole('button', { name: '继续' })) // 推进进「雷」节点触发运行时错误
    expect(await screen.findByText(/运行期错误/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 存档当前进度' }))
    expect(screen.queryByText('已存档')).not.toBeInTheDocument()
    expect(screen.queryByText('存档失败，请稍后重试')).not.toBeInTheDocument()
    expect(listSaves(KEY).filter((s) => s.kind === 'manual')).toHaveLength(0) // 脚本出错的位置没被存下来
  })

  it('删除写入失败 → 提示「删除失败，请稍后重试」（与手动 / 自动存档统一口径，不再静默吞掉）', async () => {
    vi.mocked(loadStory).mockResolvedValue({ ok: true, value: realLoaded() })
    putSave({ id: 'm1', kind: 'manual', seed: 12345, seq: [] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('雾港之夜')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    // 面板此时两行：auto 置顶、m1 在后——删的是 m1 那条。
    await userEvent.click(screen.getAllByRole('button', { name: '删除存档' })[1]!)
    await userEvent.click(screen.getByRole('button', { name: '确定删除?' }))
    expect(await screen.findByText('删除失败，请稍后重试')).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})
