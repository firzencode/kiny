import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { zipSync, strToU8 } from 'fflate'
import { App } from './App'

const MAIN = '=== 开场 ===\n你站在门口。\n* [推门进去] -> 里屋\n* [转身离开] -> END\n=== 里屋 ===\n屋里很暖。\n-> END\n'
// 两段连续选择：开场 -> 里屋（未结束的选择点）-> 左/右。用于验证「继续」在中途（非结局）存档下
// 恢复到正确位置——里屋停留时的 auto 存档若被错误地配上起点 story 重播，会甩回开场重出选项。
const MAIN2 = '=== 开场 ===\n你站在门口。\n* [推门进去] -> 里屋\n=== 里屋 ===\n屋里很暖，有两扇门。\n* [走左门] -> 左\n* [走右门] -> 右\n=== 左 ===\n左边是书房。\n-> END\n=== 右 ===\n右边是厨房。\n-> END\n'
function kipFile(name: string, main = MAIN): File {
  const manifest = JSON.stringify({ name, version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
  const bytes = zipSync({ 'kiny.json': strToU8(manifest), 'main.kin': strToU8(main) })
  return new File([bytes], `${name}.kip`, { type: 'application/zip' })
}

beforeEach(async () => {
  localStorage.clear()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('kiny-shelf')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

describe('App', () => {
  it('首屏空书架', async () => {
    render(<App />)
    expect(await screen.findByText(/书架还空着/)).toBeInTheDocument()
  })

  it('导入 → 开始阅读见正文 → 返回', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('海边'))
    expect(await screen.findByText('海边')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /开始/ }))
    expect(await screen.findByText(/你站在门口/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    expect(await screen.findByText('海边')).toBeInTheDocument()
  })

  it('阅读后返回 → 书架出现「继续」，续读回到进度', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('续读书'))
    await userEvent.click(await screen.findByRole('button', { name: /开始/ }))
    // 推进一步（写 auto 续读档到「里屋」）
    await userEvent.click(await screen.findByText('推门进去'))
    expect(await screen.findByText('屋里很暖。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    // 书架出现「继续」入口
    const cont = await screen.findByRole('button', { name: /继续/ })
    await userEvent.click(cont)
    // 续读回到「里屋」进度（auto 停在做选择后的暂停点）
    expect(await screen.findByText('屋里很暖。')).toBeInTheDocument()
  })

  it('中途（未结束）续读 → 「继续」恢复到存档位置而非甩回开场', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('中途书', MAIN2))
    await userEvent.click(await screen.findByRole('button', { name: /开始/ }))
    // 推进到「里屋」的选择点（未结束），写中途 auto 存档
    await userEvent.click(await screen.findByText('推门进去'))
    expect(await screen.findByText('屋里很暖，有两扇门。')).toBeInTheDocument()
    expect(await screen.findByText('走左门')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    const cont = await screen.findByRole('button', { name: /继续/ })
    await userEvent.click(cont)
    // 应恢复到「里屋」——见其正文与选项（走左门），而非被起点 story 甩回开场重出选项
    expect(await screen.findByText('屋里很暖，有两扇门。')).toBeInTheDocument()
    const leftDoor = await screen.findByText('走左门')
    await userEvent.click(leftDoor)
    expect(await screen.findByText('左边是书房。')).toBeInTheDocument()
  })

  it('删除书 → 连带清存档（该书不再可续读）', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('待删书'))
    await userEvent.click(await screen.findByRole('button', { name: /开始/ }))
    await userEvent.click(await screen.findByText('推门进去')) // 产生 auto 存档
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    await screen.findByRole('button', { name: /继续/ }) // 确有续读档
    await userEvent.click(screen.getByRole('button', { name: /删除/ }))
    await userEvent.click(screen.getByRole('button', { name: /确定删除/ }))
    await waitFor(() => expect(screen.queryByText('待删书')).not.toBeInTheDocument())
    // localStorage 里该书的存档已清空
    const leftover = Object.keys(localStorage).filter((k) => k.startsWith('kiny-shelf-save:'))
    expect(leftover).toHaveLength(0)
  })

  it('「继续」恢复失败 → 从头进入阅读，且错误提示在阅读视图仍可见（toast 顶层渲染）', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('坏档书'))
    await userEvent.click(await screen.findByRole('button', { name: /开始/ }))
    await userEvent.click(await screen.findByText('推门进去')) // 产生 auto 存档
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    await screen.findByRole('button', { name: /继续/ })
    // 把 auto 存档的 snapshot 换成垃圾：保持 SaveRecord 形状（绕过 readSave 的损坏过滤），
    // 让 restoreStory 走 version 检查返回 corrupt——确定性触发「恢复失败、从头开始」降级。
    const key = Object.keys(localStorage).find((k) => k.startsWith('kiny-shelf-save:'))!
    const rec = JSON.parse(localStorage.getItem(key)!) as { snapshot: unknown }
    rec.snapshot = { bogus: true }
    localStorage.setItem(key, JSON.stringify(rec))
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    // 单一 return 的顶层 toast：进入阅读（从头）后错误提示不因视图切换丢失
    expect(await screen.findByText(/你站在门口/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/存档已损坏/)
  })

  it('导入坏包 → 错误提示、书架仍空', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    const bad = new File([new Uint8Array([1, 2, 3, 4])], 'bad.kip')
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), bad)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/书架还空着/)).toBeInTheDocument()
  })

  it('拖放 .kip → 导入进书架', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    const dt = { files: [kipFile('拖来的')], items: [], types: ['Files'] } as unknown as DataTransfer
    fireEvent.dragOver(window, { dataTransfer: dt })
    fireEvent.drop(window, { dataTransfer: dt })
    expect(await screen.findByText('拖来的')).toBeInTheDocument()
  })

  it('书架底部显示「Made with Kiny」署名', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    expect(screen.getByRole('link', { name: /Made with Kiny/ })).toBeInTheDocument()
  })

  it('免责声明：空书架与有书两态均恰好出现一次', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    expect(screen.getAllByText(/本站不上传、不存储任何内容/)).toHaveLength(1)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('声明书'))
    await screen.findByText('声明书')
    expect(screen.getAllByText(/本站不上传、不存储任何内容/)).toHaveLength(1)
  })
})
