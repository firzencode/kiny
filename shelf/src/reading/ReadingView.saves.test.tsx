import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { advance, initialState, type ResolveAsset } from '@kiny/player'
import { assembleFromFiles } from '@kiny/engine'
import { captureSave } from '../saves/snapshot'
import { AUTO_SAVE_ID } from '../saves/types'
import { ReadingView } from './ReadingView'

// 存档 API 已异步化（IndexedDB）：桩一律返回 Promise，否则 ReadingView 的 await 会拿到
// undefined 而看不出真实的成败分支。
const listSaves = vi.fn()
const writeSaveSerial = vi.fn()
const deleteSave = vi.fn()
vi.mock('../saves/store', () => ({
  listSaves: (...a: unknown[]) => listSaves(...a),
  writeSaveSerial: (...a: unknown[]) => writeSaveSerial(...a),
  deleteSave: (...a: unknown[]) => deleteSave(...a),
  genSaveId: () => 'cafe',
}))

const MANIFEST = JSON.stringify({ name: 'T', version: '1', engine: '0.1.0', entry: 'main.kin' })
const KIN = '=== 开场 ===\n你站在门口。\n* [推门进去] -> 里屋\n* [转身离开] -> END\n=== 里屋 ===\n屋里很暖。\n-> END\n'
const resolve: ResolveAsset = (n) => n

function build() {
  const out = assembleFromFiles(MANIFEST, new Map([['main.kin', KIN]]), { seed: 1 })
  if (!out.ok) throw new Error(out.message)
  return out
}
function makeOpeningSave(id = 'beef') {
  const snap = build()
  const first = advance(snap.story, initialState, resolve).state
  return captureSave(snap.story, first, 'manual', id, 1000, 'abc')
}

describe('ReadingView 存档 / 读档', () => {
  beforeEach(() => {
    listSaves.mockReset().mockResolvedValue([])
    writeSaveSerial.mockReset().mockResolvedValue(undefined)
    deleteSave.mockReset().mockResolvedValue(undefined)
  })

  function renderRV() {
    const out = build()
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    return { out }
  }

  it('mount 自动写一条 auto 存档', async () => {
    renderRV()
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalled())
    const [sid, save] = writeSaveSerial.mock.calls[0] as [string, { kind: string; id: string }]
    expect(sid).toBe('abc')
    expect(save.kind).toBe('auto')
    expect(save.id).toBe(AUTO_SAVE_ID)
  })

  it('点选项推进后再写 auto 存档', async () => {
    renderRV()
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalledTimes(2))
  })

  it('面板「存档当前进度」→ writeSaveSerial(manual)', async () => {
    renderRV()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: /存档当前进度/ }))
    const manual = writeSaveSerial.mock.calls.find((c) => (c[1] as { kind: string }).kind === 'manual')
    expect(manual).toBeTruthy()
    expect((manual![1] as { id: string }).id).toBe('cafe')
  })

  it('读取手动存档 → 回到该存点内容', async () => {
    const out = build()
    listSaves.mockResolvedValue([makeOpeningSave()])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    await userEvent.click(screen.getByText('推门进去'))
    expect(screen.getByText('屋里很暖。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取' }))
    await waitFor(() => expect(screen.getByText('你站在门口。')).toBeInTheDocument())
  })

  it('读档不写 auto；载入后做选择 auto 才前移', async () => {
    const out = build()
    listSaves.mockResolvedValue([makeOpeningSave()])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取' }))
    await waitFor(() => expect(screen.getByText('你站在门口。')).toBeInTheDocument())
    expect(writeSaveSerial).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalledTimes(3))
  })

  it('删除存档两步确认：首点转确认、二次点才删', async () => {
    const out = build()
    listSaves.mockResolvedValue([makeOpeningSave()])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '删除存档' }))
    expect(deleteSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /确定删除/ }))
    expect(deleteSave).toHaveBeenCalledWith('abc', 'beef')
  })

  it('手动存档后出现「已存档」toast', async () => {
    renderRV()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: /存档当前进度/ }))
    expect(await screen.findByText('已存档')).toBeInTheDocument()
  })

  it('手动存档写盘失败 → 「存档失败」提示（不谎报已存档）', async () => {
    writeSaveSerial.mockReset().mockRejectedValue(new Error('配额满'))
    renderRV()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: /存档当前进度/ }))
    expect(await screen.findByText(/存档失败/)).toBeInTheDocument()
    expect(screen.queryByText('已存档')).not.toBeInTheDocument()
  })

  it('自动存档失败 → 给出提示，不再静默（回归：读者毫无察觉、下次回来进度悄悄回退）', async () => {
    writeSaveSerial.mockReset().mockRejectedValue(new Error('配额满'))
    renderRV()
    // 措辞区别于手动存档：读者没主动做这个动作，得说清是「自动保存」失败了。
    expect(await screen.findByText(/自动保存进度失败/)).toBeInTheDocument()
  })

  it('自动存档成功时不打扰读者（不弹提示）', async () => {
    renderRV()
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalled())
    expect(screen.queryByText(/自动保存进度失败/)).not.toBeInTheDocument()
    expect(screen.queryByText('已存档')).not.toBeInTheDocument()
  })

  it('卸载后异步回调不再 setState（存档 API 异步化后的守卫）', async () => {
    // 断言落在 showToast 的副作用（它必调 setTimeout）上，而不是 React 的卸载警告——
    // React 18 起已移除 "state update on an unmounted component"，靠它做断言等于空断言：
    // 把 aliveRef 守卫整个删掉也照样绿。
    const rawTimeout = globalThis.setTimeout
    const flush = () => new Promise<void>((r) => { rawTimeout(r, 0) }) // 原始引用，不计入下面的 spy
    let release!: () => void
    writeSaveSerial.mockReset().mockImplementation(
      () => new Promise<void>((_res, rej) => { release = () => rej(new Error('晚到的失败')) }),
    )
    const out = build()
    const { unmount } = render(
      <ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />,
    )
    await waitFor(() => expect(writeSaveSerial).toHaveBeenCalled())
    unmount()

    const timer = vi.spyOn(globalThis, 'setTimeout')
    try {
      release() // 写入在卸载之后才失败：不得再弹 toast、不得碰已卸载组件的 state
      await flush()
      expect(timer).not.toHaveBeenCalled()
    } finally {
      timer.mockRestore() // 断言失败也要还原，否则 spy 泄进同文件后续用例
    }
  })

  describe('persistent=false（临时模式：书不持久）', () => {
    function renderEphemeral() {
      const out = build()
      // 临时模式的书没落库、没 id——两个条件各自都足以关掉存档，这里连 storyId 一起给上，
      // 确保关掉存档的确是 persistent 在起作用，而不是「碰巧没 id」。
      render(
        <ReadingView
          story={out.story} program={out.program} storyId="abc" resolveAsset={resolve}
          title="T" onBack={() => {}} persistent={false}
        />,
      )
      return { out }
    }

    it('不写 auto 存档（否则留下指向不存在的书的孤儿档）', async () => {
      renderEphemeral()
      await screen.findByText(/你站在门口/)
      await waitFor(() => expect(screen.getByText('推门进去')).toBeInTheDocument())
      expect(writeSaveSerial).not.toHaveBeenCalled()
    })

    it('不弹「自动保存进度失败」（本就没打算存，不是存失败）', async () => {
      // 临时模式下每个暂停点都报一次假失败，会正面推翻「存不住是既定事实、不是出了问题」
      // 这条承诺——书架那边特意用信息条而非红色横幅，正是为了这个。
      renderEphemeral()
      await screen.findByText(/你站在门口/)
      await userEvent.click(await screen.findByText('推门进去')) // 再过一个暂停点
      await screen.findByText(/屋里很暖/)
      expect(screen.queryByText(/自动保存进度失败/)).not.toBeInTheDocument()
    })

    it('不显示「存档 / 读档」入口', async () => {
      renderEphemeral()
      await screen.findByText(/你站在门口/)
      expect(screen.queryByRole('button', { name: '存档 / 读档' })).not.toBeInTheDocument()
    })

    it('不读存档列表（不去翻一本不存在的书的档）', async () => {
      renderEphemeral()
      await screen.findByText(/你站在门口/)
      expect(listSaves).not.toHaveBeenCalled()
    })

    it('正文照常可读、可推进（降级只关存档，不影响阅读）', async () => {
      renderEphemeral()
      await userEvent.click(await screen.findByText('推门进去'))
      expect(await screen.findByText(/屋里很暖/)).toBeInTheDocument()
    })

    it('persistent 缺省 = true：正常模式零回归', async () => {
      renderRV()
      await waitFor(() => expect(writeSaveSerial).toHaveBeenCalled())
      expect(screen.getByRole('button', { name: '存档 / 读档' })).toBeInTheDocument()
    })
  })
})
