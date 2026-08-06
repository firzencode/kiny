import { describe, it, expect } from 'vitest'
import { serialize } from './serialQueue'

/** 受控任务：手动决定何时完成，用来做确定性时序断言。 */
function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 让已排入的微任务跑完（链头经过两跳 `catch().then()` 才唤起 task）。 */
const flush = () => new Promise((r) => setTimeout(r, 0))

// 链表是模块级、跨用例存活，故**每条用例用各自的 key**——共用 key 时任一用例留下未 settle
// 的链会把后续同 key 的用例全部挂死（不给生产代码开测试专用的 reset 出口）。
describe('serialize —— 按 key 串行化', () => {
  it('同一 key：后发起的任务在前一个完成之前不启动（乱序即存档回退）', async () => {
    const log: string[] = []
    const slow = deferred()
    const p1 = serialize('k1', async () => { log.push('慢-开始'); await slow.promise; log.push('慢-结束') })
    const p2 = serialize('k1', async () => { log.push('快-开始'); log.push('快-结束') })

    await flush()
    expect(log).toEqual(['慢-开始']) // 第二个任务**尚未启动**
    slow.resolve()
    await Promise.all([p1, p2])
    expect(log).toEqual(['慢-开始', '慢-结束', '快-开始', '快-结束'])
  })

  it('不同 key 各自成链，互不阻塞', async () => {
    const log: string[] = []
    const blocked = deferred()
    const pA = serialize('k2-a', async () => { await blocked.promise; log.push('a') })
    const pB = serialize('k2-b', async () => { log.push('b') })

    await pB
    expect(log).toEqual(['b']) // b 没被卡住的 a 挡住
    blocked.resolve()
    await pA
    expect(log).toEqual(['b', 'a'])
  })

  it('单次失败不断链：后续任务照常执行', async () => {
    const log: string[] = []
    const p1 = serialize('k3', async () => { log.push('炸'); throw new Error('写失败') })
    const p2 = serialize('k3', async () => { log.push('续') })

    await expect(p1).rejects.toThrow('写失败') // 失败原样抛给调用方，不被链吞掉
    await p2
    expect(log).toEqual(['炸', '续'])
  })

  it('失败任务的 promise 不被链上的 catch 吞掉（调用方据实反馈成败）', async () => {
    await expect(serialize('k4', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('链空闲后再排队照常（不因前一批已 settle 而错乱）', async () => {
    const log: string[] = []
    await serialize('k5', async () => { log.push('一') })
    await serialize('k5', async () => { log.push('二') })
    expect(log).toEqual(['一', '二'])
  })
})
