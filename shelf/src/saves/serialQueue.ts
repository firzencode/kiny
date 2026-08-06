/**
 * 按 key 串行化异步任务：同一 key 的任务链式排队，严格按**发起顺序**执行。
 *
 * 存档从 localStorage（同步 API）搬到 IndexedDB（事务）后，「浏览器 JS 单线程 → 无并发写乱序」
 * 这个前提失效：快速连点选项时两次对同一 auto 档的写入，事务完成顺序无保证，旧态可能后落盘
 * 覆盖新态，读者的进度就此回退。同 reader 的 `writeSaveSerial`。
 *
 * 链**不因单次失败断裂**：前一个任务无论成败，后一个都照常接上（`catch` 后继续）。
 * 调用方拿到的仍是本次任务真实的 promise（失败会 reject），不被链上的 catch 吞掉。
 */
const chains = new Map<string, Promise<unknown>>()

export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(task)
  const settled = next.catch(() => {})
  chains.set(key, settled)
  // 链尾跑完就把条目撤掉（`chains` 是模块级常驻，否则每本读过的书都留一条永不回收的记录）。
  // 只在自己**仍是链尾**时删：期间若又有任务入队，链尾已是别人，删掉会把它从队里摘出去。
  void settled.then(() => { if (chains.get(key) === settled) chains.delete(key) })
  return next
}
