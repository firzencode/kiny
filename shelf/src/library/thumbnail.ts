/**
 * 封面缩略图：书架列表只需一枚 58×78 的小图，而作者的封面原图动辄几 MB。
 * `stories` store 是列表的唯一数据源、每次开书架都整表读出，直接存原图会把 IndexedDB
 * 撑大、也拖慢列表。故导入时按下述预算压一版存进 `stories`——**原图并不丢失**，它随
 * 整包躺在 `packages` store 里，阅读时照常取用。
 */

/** 缩略图长边上限（px）。列表渲染 58×78，留足高 DPR 与将来放大的余量。 */
export const THUMB_MAX_EDGE = 512

/** 体积预算（字节）：尺寸本已够小、但字节数超此值的封面同样重编码一版。 */
export const THUMB_MAX_BYTES = 128 * 1024

const THUMB_TYPE = 'image/webp'
const THUMB_QUALITY = 0.82

/** 等比缩到长边不超过 maxEdge 的尺寸；本就不超则原样返回（**只缩不放**）。至少留 1px。 */
export function fitWithin(width: number, height: number, maxEdge = THUMB_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * 把封面压成缩略图。**任何一步不成都回退原图**——封面是锦上添花，绝不因它中断导入或
 * 丢掉图；产出反而更大时也保留原图（缩略图只许更省）。
 * 环境缺 `createImageBitmap` / `OffscreenCanvas`（老浏览器、非浏览器测试环境）同样回退。
 *
 * 因回退存在，`THUMB_MAX_EDGE` 是**尽力而为**的上限而非硬约束：压不动时存的仍是原尺寸原图。
 * 动图封面（GIF / APNG / 动态 WebP）取首帧，列表里成静态图；原图在包体内仍是动的。
 */
export async function makeCoverThumb(cover: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return cover

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(cover)
  } catch {
    return cover // 解码不了（格式怪 / 文件坏）：原样存，交浏览器 <img> 自己去试
  }

  try {
    const fit = fitWithin(bitmap.width, bitmap.height)
    const fits = fit.width === bitmap.width && fit.height === bitmap.height
    if (fits && cover.size <= THUMB_MAX_BYTES) return cover // 两项预算都达标，不做无谓的重编码

    const canvas = new OffscreenCanvas(fit.width, fit.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return cover
    ctx.imageSmoothingQuality = 'high' // 大幅缩小时默认重采样锯齿明显
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height)
    const thumb = await canvas.convertToBlob({ type: THUMB_TYPE, quality: THUMB_QUALITY })
    return thumb.size < cover.size ? thumb : cover
  } catch {
    return cover
  } finally {
    bitmap.close?.()
  }
}
