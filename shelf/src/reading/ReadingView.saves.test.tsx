import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { advance, initialState, type ResolveAsset } from '@kiny/player'
import { assembleFromFiles } from '@kiny/engine'
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
  const out = assembleFromFiles(MANIFEST, new Map([['main.kin', KIN]]), { seed: 1 })
  if (!out.ok) throw new Error(out.message)
  return out
}
function makeOpeningSave(id = 'beef') {
  const snap = build()
  const first = advance(snap.story, initialState, resolve).state
  return captureSave(snap.story, first, 'manual', id, 1000)
}

describe('ReadingView 存档 / 读档', () => {
  beforeEach(() => {
    listSaves.mockReset().mockReturnValue([])
    writeSave.mockReset().mockReturnValue(undefined)
    deleteSave.mockReset().mockReturnValue(undefined)
  })

  function renderRV() {
    const out = build()
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    return { out }
  }

  it('mount 自动写一条 auto 存档', async () => {
    renderRV()
    await waitFor(() => expect(writeSave).toHaveBeenCalled())
    const [sid, save] = writeSave.mock.calls[0] as [string, { kind: string; id: string }]
    expect(sid).toBe('abc')
    expect(save.kind).toBe('auto')
    expect(save.id).toBe(AUTO_SAVE_ID)
  })

  it('点选项推进后再写 auto 存档', async () => {
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
    listSaves.mockReturnValue([makeOpeningSave()])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    await userEvent.click(screen.getByText('推门进去'))
    expect(screen.getByText('屋里很暖。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取' }))
    await waitFor(() => expect(screen.getByText('你站在门口。')).toBeInTheDocument())
  })

  it('读档不写 auto；载入后做选择 auto 才前移', async () => {
    const out = build()
    listSaves.mockReturnValue([makeOpeningSave()])
    render(<ReadingView story={out.story} program={out.program} storyId="abc" resolveAsset={resolve} title="T" onBack={() => {}} />)
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取' }))
    await waitFor(() => expect(screen.getByText('你站在门口。')).toBeInTheDocument())
    expect(writeSave).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByText('推门进去'))
    await waitFor(() => expect(writeSave).toHaveBeenCalledTimes(3))
  })

  it('删除存档两步确认：首点转确认、二次点才删', async () => {
    const out = build()
    listSaves.mockReturnValue([makeOpeningSave()])
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
    writeSave.mockReset().mockImplementation(() => { throw new Error('配额满') })
    renderRV()
    await userEvent.click(screen.getByRole('button', { name: '存档 / 读档' }))
    await userEvent.click(screen.getByRole('button', { name: /存档当前进度/ }))
    expect(await screen.findByText(/存档失败/)).toBeInTheDocument()
    expect(screen.queryByText('已存档')).not.toBeInTheDocument()
  })
})
