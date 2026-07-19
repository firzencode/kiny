/**
 * 最近最少使用（LRU）上限缓存。用 Map 的插入序当 LRU 序：命中时删除后重插到末端（最新），
 * 满时逐出首键（最旧）。供 env.ts 的编译产物缓存用——把模块级永生 Map（editor 长会话内存单增）
 * 换成有界缓存；被逐出的键下次命中会重算，故仅适用于「值可由键纯函数重建」的缓存。
 */
export class LruCache<V> {
  private map = new Map<string, V>()
  constructor(private readonly max: number) {}

  get(k: string): V | undefined {
    const v = this.map.get(k)
    if (v !== undefined) {
      this.map.delete(k)
      this.map.set(k, v) // 命中 → 移到最新端
    }
    return v
  }

  set(k: string, v: V): void {
    if (this.map.has(k)) this.map.delete(k)
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string) // 逐出最旧
    this.map.set(k, v)
  }

  has(k: string): boolean {
    return this.map.has(k)
  }

  get size(): number {
    return this.map.size
  }
}
