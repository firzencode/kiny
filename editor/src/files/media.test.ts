import { describe, it, expect } from 'vitest'
import { mediaKind } from './media'

describe('mediaKind', () => {
  it('图片扩展名 → image', () => {
    for (const p of ['立绘.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.svg', 'a.bmp']) {
      expect(mediaKind(p)).toBe('image')
    }
  })

  it('音频扩展名 → audio', () => {
    for (const p of ['雨.mp3', 'a.ogg', 'a.wav', 'a.m4a', 'a.aac', 'a.flac']) {
      expect(mediaKind(p)).toBe('audio')
    }
  })

  it('大小写不敏感', () => {
    expect(mediaKind('图/封面.PNG')).toBe('image')
    expect(mediaKind('音/BGM.Mp3')).toBe('audio')
  })

  it('只看最后一段扩展名（多点文件名）', () => {
    expect(mediaKind('立绘.png.txt')).toBeNull()
    expect(mediaKind('主角.立绘.png')).toBe('image')
  })

  it('文本 / 字体 / 无扩展名 → null（字体本期不做预览）', () => {
    for (const p of ['main.kin', 'theme.css', 'a.woff2', 'a.ttf', 'a.otf', 'README', '资源/'])
      expect(mediaKind(p)).toBeNull()
  })

  it('以点开头的文件名不算扩展名', () => {
    expect(mediaKind('.png')).toBeNull()
    expect(mediaKind('图/.mp3')).toBeNull()
  })
})
