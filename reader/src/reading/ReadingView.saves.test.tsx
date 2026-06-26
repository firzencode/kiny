import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { advance, initialState, type ResolveAsset } from '@kiny/player'
import { assembleStory } from './assembleStory'
import { captureSave } from '../saves/snapshot'
import { AUTO_SAVE_ID } from '../saves/types'
import { ReadingView } from './ReadingView'

const listSaves = vi.fn()
const writeSave = vi.fn()
const deleteSave = vi.fn()
vi.mock('../saves/store', () => ({
  listSaves: (...a: unknown[]) => listSaves(...a),
  writeSave: (...a: unknown[]) => writeSave(...a),
  deleteSave: (...a: unknown[]) => deleteSave(...a),
  genSaveId: () => 'cafe',
}))

const MANIFEST = JSON.stringify({ name: 'T', version: '1', engine: '0.1.0', entry: 'main.kin' })
const KIN = '=== 开场 ===\n你站在门口。\n* [推门进去] -> 里屋\n* [转身离开] -> END\n=== 里屋 ===\n屋里很暖。\n-> END\n'
const resolve: ResolveAsset = (n) => n

function build() {
  const out = assembleStory(MANIFEST, new Map([['main.kin', KIN]]), 1)
  if (!out.ok) throw new Error(out.message)
  return out
}

describe('ReadingView 存档 / 读档', () => {
  beforeEach(() => {
    listSaves.mockReset().mockResolvedValue([])
    writeSave.mockReset().mockResolvedValue(undefined)
    deleteSave.mockReset().mockResolvedValue(undefined)
  })

  function renderRV() {
    const out = build()
    const first = advance(out.story, initialState, resolve).state
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    return { out, first }
  }

  it('mount 自动写一条 auto 存档', async () => {
    renderRV()
    await waitFor(() => expect(writeSave).toHaveBeenCalled())
    const [sid, save] = writeSave.mock.calls[0] as [string, { kind: string; id: string }]
    expect(sid).toBe('abc')
    expect(save.kind).toBe('auto')
    expect(save.id).toBe(AUTO_SAVE_ID)
  })

  it('点选项推进后再写 auto 存档（续读更新）', async () => {
    renderRV()
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(2))
  })

  it('面板「存档当前进度」→ writeSave(manual)', async () => {
    renderRV()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: /存档当前进度/ }))
    const manual = writeSave.mock.calls.find((c) => (c[1] as { kind: string }).kind === 'manual')
    expect(manual).toBeTruthy()
    expect((manual![1] as { id: string }).id).toBe('cafe')
  })

  it('读取手动存档 → 回到该存点内容', async () => {
    const out = build()
    const first = advance(out.story, initialState, resolve).state
    const save = captureSave(out.story, first, 'manual', 'beef', 1000) // 开场存点
    listSaves.mockResolvedValue([save])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    // 先推进离开开场
    await userEvent.click(screen.getByText('推门进去'))
    expect(screen.getByText('屋里很暖。')).toBeInTheDocument()
    // 开面板读取开场存档 → 回到开场内容
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取' }))
    await waitFor(() => expect(screen.getByText('你站在门口。')).toBeInTheDocument())
  })

  it('读档不写自动存档；载入位置做选择后 auto 才前移', async () => {
    const out = build()
    const first = advance(out.story, initialState, resolve).state
    const save = captureSave(out.story, first, 'manual', 'beef', 1000) // 开场存点
    listSaves.mockResolvedValue([save])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(1)) // 开局 auto
    await userEvent.click(screen.getByText('推门进去')) // 做选择 → auto 前移
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(2))
    // 读取开场存档：只切渲染态，不写 auto
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取' }))
    await waitFor(() => expect(screen.getByText('你站在门口。')).toBeInTheDocument())
    expect(writeSave).toHaveBeenCalledTimes(2) // 读档没有新增 auto 写入
    // 在载入位置做一个选择 → auto 这才前移
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(3))
  })

  it('删除存档：首点 🗑 不删、转为确认态', async () => {
    const out = build()
    const first = advance(out.story, initialState, resolve).state
    const save = captureSave(out.story, first, 'manual', 'beef', 1000)
    listSaves.mockResolvedValue([save])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '删除存档' }))
    expect(deleteSave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /确定删除/ })).toBeInTheDocument()
  })

  it('删除存档：二次点确认才真正删除', async () => {
    const out = build()
    const first = advance(out.story, initialState, resolve).state
    const save = captureSave(out.story, first, 'manual', 'beef', 1000)
    listSaves.mockResolvedValue([save])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '删除存档' }))
    await userEvent.click(screen.getByRole('button', { name: /确定删除/ }))
    expect(deleteSave).toHaveBeenCalledWith('abc', 'beef')
  })

  it('删除确认态点别处即还原', async () => {
    const out = build()
    const first = advance(out.story, initialState, resolve).state
    const save = captureSave(out.story, first, 'manual', 'beef', 1000)
    listSaves.mockResolvedValue([save])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '删除存档' }))
    expect(screen.getByRole('button', { name: /确定删除/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('heading', { name: '存档 / 读档' })) // 点面板别处
    expect(screen.queryByRole('button', { name: /确定删除/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除存档' })).toBeInTheDocument()
    expect(deleteSave).not.toHaveBeenCalled()
  })

  it('手动存档后出现「已存档」toast', async () => {
    renderRV()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: /存档当前进度/ }))
    expect(await screen.findByText('已存档')).toBeInTheDocument()
  })
})
