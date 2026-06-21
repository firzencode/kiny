// 生成占位 demo 资源（无第三方依赖）。
// 渐变 BMP（命名 .jpg）+ 正弦 WAV（命名 .mp3）；浏览器按内容嗅探渲染/播放。
// 真·美术/音乐可同名替换。
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo', 'assets')
mkdirSync(dir, { recursive: true })

function gradientBMP(w, h, top, bot) {
  const rowSize = Math.ceil((w * 3) / 4) * 4
  const pixelArraySize = rowSize * h
  const fileSize = 54 + pixelArraySize
  const buf = Buffer.alloc(fileSize)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(w, 18)
  buf.writeInt32LE(h, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30)
  buf.writeUInt32LE(pixelArraySize, 34)
  for (let y = 0; y < h; y++) {
    const r = (h - 1 - y) / (h - 1) // 图像自上而下的比例（BMP 自下而上存储）
    const R = Math.round(top[0] + (bot[0] - top[0]) * r)
    const G = Math.round(top[1] + (bot[1] - top[1]) * r)
    const B = Math.round(top[2] + (bot[2] - top[2]) * r)
    const rowStart = 54 + y * rowSize
    for (let x = 0; x < w; x++) {
      const p = rowStart + x * 3
      buf[p] = B; buf[p + 1] = G; buf[p + 2] = R
    }
  }
  return buf
}

function toneWAV(seconds, freq, sampleRate = 8000, amp = 0.04) {
  const n = Math.floor(seconds * sampleRate)
  const dataSize = n * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

writeFileSync(join(dir, 'harbor_fog.jpg'), gradientBMP(320, 180, [40, 60, 80], [12, 18, 28]))
writeFileSync(join(dir, 'tavern_interior.jpg'), gradientBMP(320, 180, [90, 60, 35], [30, 18, 10]))
writeFileSync(join(dir, 'ambient_fog.mp3'), toneWAV(2, 110, 8000, 0.04))
console.log('demo assets written to', dir)
