import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { zipSync, strToU8 } from 'fflate'
import { App } from './App'
import { openDb, STORE_SAVES } from './library/db'
import { listSaves } from './saves/store'
import { AUTO_SAVE_ID } from './saves/types'

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

/** 直接改库里那条 auto 存档的 snapshot 为垃圾（存档已迁 IndexedDB，不再在 localStorage 里）。 */
async function corruptAutoSnapshot(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_SAVES, 'readwrite')
    const store = tx.objectStore(STORE_SAVES)
    const all = await new Promise<Record<string, unknown>[]>((res, rej) => {
      const r = store.getAll()
      r.onsuccess = () => res(r.result as Record<string, unknown>[])
      r.onerror = () => rej(r.error)
    })
    for (const rec of all) if (rec.id === AUTO_SAVE_ID) store.put({ ...rec, snapshot: { bogus: true } })
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
  } finally {
    db.close()
  }
}

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
    // 把 auto 存档的 snapshot 换成垃圾：保持 SaveRecord 形状（绕过 readSave 的形状过滤），
    // 让 restoreStory 走 version 检查返回 corrupt——确定性触发「恢复失败、从头开始」降级。
    await corruptAutoSnapshot()
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    // 单一 return 的顶层 toast：进入阅读（从头）后错误提示不因视图切换丢失
    expect(await screen.findByText(/你站在门口/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/存档已损坏/)
  })

  it('从旧版本升级：localStorage 旧档搬进新库后「继续」入口照常出现，源键已清空', async () => {
    render(<App />)
    await screen.findByText(/书架还空着/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('升级书'))
    await userEvent.click(await screen.findByRole('button', { name: /开始/ }))
    await userEvent.click(await screen.findByText('推门进去')) // 产生 auto 存档（已在 IndexedDB）
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    await screen.findByRole('button', { name: /继续/ })

    // 把这条 auto 档倒回 localStorage（旧版本的形态：无 storyId 字段、编在键名里），
    // 再重挂 App —— 迁移应把它搬回新库，「继续」入口照常。
    const [rec] = await listSaves('__probe__') // 触发一次 open，确保库已建好
    void rec
    const db = await openDb()
    const all = await new Promise<Record<string, unknown>[]>((res, rej) => {
      const tx = db.transaction(STORE_SAVES, 'readwrite')
      const r = tx.objectStore(STORE_SAVES).getAll()
      r.onsuccess = () => { tx.objectStore(STORE_SAVES).clear(); res(r.result as Record<string, unknown>[]) }
      r.onerror = () => rej(r.error)
    })
    db.close()
    const auto = all.find((r) => r.id === AUTO_SAVE_ID)!
    const { storyId, ...withoutStoryId } = auto as { storyId: string }
    localStorage.setItem(`kiny-shelf-save:${storyId}:${AUTO_SAVE_ID}`, JSON.stringify(withoutStoryId))

    cleanup()
    render(<App />)
    expect(await screen.findByRole('button', { name: /继续/ })).toBeInTheDocument()
    expect(Object.keys(localStorage).filter((k) => k.startsWith('kiny-shelf-save:'))).toHaveLength(0)
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

describe('App 临时模式（IndexedDB 不可用）', () => {
  const realIndexedDB = globalThis.indexedDB
  /** 隐私模式的典型形态：`indexedDB.open` 直接抛。整段书库通路必失败 → 探测转临时模式。 */
  const killIndexedDB = () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { open: () => { throw new DOMException('denied', 'SecurityError') } },
      configurable: true, writable: true,
    })
  }
  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { value: realIndexedDB, configurable: true, writable: true })
  })

  it('降级态**不迁移**旧档：localStorage 里的存档原样保留（读者最没退路时不能再抹掉它）', async () => {
    localStorage.setItem(
      'kiny-shelf-save:book:m1',
      JSON.stringify({ id: 'm1', kind: 'manual', snapshot: {}, play: {}, meta: { timestamp: 1, label: 'x' } }),
    )
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    expect(localStorage.getItem('kiny-shelf-save:book:m1')).not.toBeNull()
  })

  it('探测失败 → 引导页 + 信息条，且不是错误横幅（存不住是既定事实，不是出了问题）', async () => {
    killIndexedDB()
    render(<App />)
    expect(await screen.findByText(/导入一本，当场阅读/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/仅本次可读/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // 不走 toast-error
  })

  it('导入 .kip → 直达阅读见正文（不落库）', async () => {
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('临时书'))
    expect(await screen.findByText(/你站在门口/)).toBeInTheDocument() // 不经书架，直接进阅读
  })

  it('临时模式阅读无存档入口（书不持久，存档指针没有依附对象）', async () => {
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('无档书'))
    await screen.findByText(/你站在门口/)
    expect(screen.queryByRole('button', { name: /存档/ })).not.toBeInTheDocument()
  })

  it('临时模式不写 auto 存档（否则留下指向不存在的书的孤儿档）', async () => {
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('无档书'))
    await screen.findByText(/你站在门口/)
    await waitFor(() => expect(screen.getByRole('button', { name: /推门进去/ })).toBeInTheDocument())
    expect(Object.keys(localStorage)).toHaveLength(0)
  })

  it('返回 → 回到导入引导页，书不留存', async () => {
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), kipFile('过客'))
    await screen.findByText(/你站在门口/)
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    expect(await screen.findByText(/导入一本，当场阅读/)).toBeInTheDocument()
    expect(screen.queryByText('过客')).not.toBeInTheDocument() // 返回即弃，不做会话内书架
  })

  it('拖放导入也走临时路径（订阅闭包读 ref，不会停在探测前的旧值）', async () => {
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    const dt = { files: [kipFile('拖来的临时书')], types: ['Files'] }
    fireEvent.dragOver(window, { dataTransfer: dt })
    fireEvent.drop(window, { dataTransfer: dt })
    expect(await screen.findByText(/你站在门口/)).toBeInTheDocument()
  })

  it('探测窗口内拖入 .kip → 等探测落定再选路径，不弹错误横幅（回归：默认走落库必失败）', async () => {
    // 把 open 拖慢，制造一段「探测未回」的窗口，在其中投放文件。
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        open: () => {
          const req: Record<string, unknown> = { error: new DOMException('denied', 'SecurityError') }
          void gate.then(() => (req.onerror as (() => void) | undefined)?.())
          return req
        },
      },
      configurable: true, writable: true,
    })
    render(<App />)
    expect(await screen.findByText(/正在打开书库/)).toBeInTheDocument() // 探测未回：不闪书架
    const dt = { files: [kipFile('抢跑的包')], types: ['Files'] }
    fireEvent.dragOver(window, { dataTransfer: dt })
    fireEvent.drop(window, { dataTransfer: dt }) // 探测尚未落定就投放
    release()
    expect(await screen.findByText(/你站在门口/)).toBeInTheDocument() // 等到结果后走对了临时路径
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // 没撞出错误横幅
  })

  it('坏包照常报错，不静默（临时路径同样先装配校验）', async () => {
    killIndexedDB()
    render(<App />)
    await screen.findByText(/导入一本，当场阅读/)
    const bad = new File([new Uint8Array([1, 2, 3, 4])], 'bad.kip', { type: 'application/zip' })
    await userEvent.upload(screen.getByLabelText('导入故事包（.kip）'), bad)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
