import { describe, it, expect, afterEach } from 'vitest'
import { fitWithin, makeCoverThumb, THUMB_MAX_EDGE, THUMB_MAX_BYTES } from './thumbnail'

describe('fitWithin', () => {
  it('长边未超上限 → 原样返回（绝不放大）', () => {
    expect(fitWithin(120, 160, 512)).toEqual({ width: 120, height: 160 })
    expect(fitWithin(512, 512, 512)).toEqual({ width: 512, height: 512 })
  })
  it('宽边超限 → 按比例缩到上限', () => {
    expect(fitWithin(2000, 1000, 500)).toEqual({ width: 500, height: 250 })
  })
  it('高边超限 → 按比例缩到上限', () => {
    expect(fitWithin(1000, 2000, 500)).toEqual({ width: 250, height: 500 })
  })
  it('极端长条也至少留 1px，不产出 0（0 尺寸的画布画不出东西）', () => {
    expect(fitWithin(10000, 3, 500)).toEqual({ width: 500, height: 1 })
  })
})

// ── makeCoverThumb 的浏览器 API 桩 ────────────────────────────────────────────
// jsdom 没有 createImageBitmap / OffscreenCanvas，只能桩。桩的是**环境 API**，
// 被测的仍是本模块自己的判定与回退逻辑。

interface StubOpts {
  width: number
  height: number
  /** convertToBlob 产出的字节数；'throw' 表示编码失败 */
  encoded: number | 'throw'
  /** createImageBitmap 是否抛错（解码失败） */
  decodeFails?: boolean
  /** getContext 是否返回 null（老设备 / 显存不足） */
  noContext?: boolean
}

/** 记的是 drawImage 的**实参**而非画布尺寸——只记画布就测不出「漏传目标尺寸导致裁切」这类真 bug。 */
let drawn: { dx: number; dy: number; dw: number; dh: number } | undefined

function stubCanvasApis(opts: StubOpts): void {
  drawn = undefined
  globalThis.createImageBitmap = (async () => {
    if (opts.decodeFails) throw new Error('decode failed')
    return { width: opts.width, height: opts.height, close: () => {} }
  }) as unknown as typeof createImageBitmap
  globalThis.OffscreenCanvas = class {
    constructor(public width: number, public height: number) {}
    getContext() {
      if (opts.noContext) return null
      return { drawImage: (_b: unknown, dx: number, dy: number, dw: number, dh: number) => { drawn = { dx, dy, dw, dh } } }
    }
    async convertToBlob() {
      if (opts.encoded === 'throw') throw new Error('encode failed')
      return new Blob([new Uint8Array(opts.encoded)], { type: 'image/webp' })
    }
  } as unknown as typeof OffscreenCanvas
}

const bigBlob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

afterEach(() => {
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap
  delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
})

describe('makeCoverThumb', () => {
  it('浏览器没有 createImageBitmap / OffscreenCanvas → 原图返回，不报错', async () => {
    const cover = bigBlob(THUMB_MAX_BYTES * 2)
    expect(await makeCoverThumb(cover)).toBe(cover)
  })

  it('尺寸与体积都在预算内 → 原图返回，不重编码（避免无谓的画质损失）', async () => {
    stubCanvasApis({ width: 200, height: 300, encoded: 10 })
    const cover = bigBlob(1000)
    expect(await makeCoverThumb(cover)).toBe(cover)
    expect(drawn).toBeUndefined()
  })

  it('尺寸超限 → 按比例缩放后重编码，且整幅画满目标尺寸（不裁切）', async () => {
    stubCanvasApis({ width: 2048, height: 1024, encoded: 5000 })
    const thumb = await makeCoverThumb(bigBlob(400_000))
    expect(thumb.size).toBe(5000)
    expect(drawn).toEqual({ dx: 0, dy: 0, dw: THUMB_MAX_EDGE, dh: THUMB_MAX_EDGE / 2 })
  })

  it('尺寸够小但体积超预算 → 仍重编码（原尺寸重压）', async () => {
    stubCanvasApis({ width: 300, height: 400, encoded: 5000 })
    const thumb = await makeCoverThumb(bigBlob(THUMB_MAX_BYTES + 1))
    expect(thumb.size).toBe(5000)
    expect(drawn).toEqual({ dx: 0, dy: 0, dw: 300, dh: 400 })
  })

  it('拿不到 2d 上下文 → 回退原图', async () => {
    stubCanvasApis({ width: 2048, height: 2048, encoded: 10, noContext: true })
    const cover = bigBlob(400_000)
    expect(await makeCoverThumb(cover)).toBe(cover)
  })

  it('解码失败 → 回退原图（绝不因封面异常丢掉封面或中断导入）', async () => {
    stubCanvasApis({ width: 2048, height: 2048, encoded: 10, decodeFails: true })
    const cover = bigBlob(400_000)
    expect(await makeCoverThumb(cover)).toBe(cover)
  })

  it('编码失败 → 回退原图', async () => {
    stubCanvasApis({ width: 2048, height: 2048, encoded: 'throw' })
    const cover = bigBlob(400_000)
    expect(await makeCoverThumb(cover)).toBe(cover)
  })

  it('重编码结果反而更大 → 保留原图（缩略图只许更省，不许更费）', async () => {
    stubCanvasApis({ width: 2048, height: 2048, encoded: 900_000 })
    const cover = bigBlob(400_000)
    expect(await makeCoverThumb(cover)).toBe(cover)
  })
})
