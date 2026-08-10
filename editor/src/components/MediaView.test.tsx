import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaView } from './MediaView'

describe('MediaView · 图片', () => {
  it('渲染 <img>，src 为传入 url，alt 为路径', () => {
    render(<MediaView path="图/立绘.png" url="mem://图/立绘.png" kind="image" />)
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('mem://图/立绘.png')
    expect(img.getAttribute('alt')).toBe('图/立绘.png')
  })

  it('默认适应窗口；按钮切 1:1 再切回', () => {
    render(<MediaView path="a.png" url="u" kind="image" />)
    const img = screen.getByRole('img')
    expect(img.className).toContain('fit-contain')
    const btn = screen.getByRole('button', { name: '按原始尺寸显示（1:1）' })
    fireEvent.click(btn)
    expect(screen.getByRole('img').className).toContain('fit-actual')
    fireEvent.click(screen.getByRole('button', { name: '缩放至适应窗口' }))
    expect(screen.getByRole('img').className).toContain('fit-contain')
  })

  it('状态条：load 前只有文件名，load 后带像素尺寸', () => {
    render(<MediaView path="图/立绘.png" url="u" kind="image" />)
    const bar = screen.getByTestId('media-status')
    expect(bar.textContent).toContain('图/立绘.png')
    expect(bar.textContent).not.toContain('×')
    const img = screen.getByRole('img')
    Object.defineProperty(img, 'naturalWidth', { value: 1280, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 720, configurable: true })
    fireEvent.load(img)
    expect(screen.getByTestId('media-status').textContent).toContain('1280 × 720')
  })

  it('加载失败 → 占位文案，且不再渲染 <img> 与缩放按钮', () => {
    render(<MediaView path="缺失.png" url="u" kind="image" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('无法加载此资源')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: /1:1|适应窗口/ })).toBeNull()
    // 文件名仍在状态条里（作者得知道是哪个文件坏了）
    expect(screen.getByTestId('media-status').textContent).toContain('缺失.png')
  })
})

describe('MediaView · 音频', () => {
  it('渲染原生 controls 且不自动播放，无缩放按钮', () => {
    render(<MediaView path="音/雨.mp3" url="mem://音/雨.mp3" kind="audio" />)
    const audio = screen.getByTestId('media-audio') as HTMLAudioElement
    expect(audio.tagName).toBe('AUDIO')
    expect(audio.getAttribute('src')).toBe('mem://音/雨.mp3')
    expect(audio.hasAttribute('controls')).toBe(true)
    expect(audio.autoplay).toBe(false)
    expect(screen.queryByRole('button', { name: /1:1|适应窗口/ })).toBeNull()
  })

  it('状态条：元数据到达后带 mm:ss 时长', () => {
    render(<MediaView path="音/雨.mp3" url="u" kind="audio" />)
    const audio = screen.getByTestId('media-audio')
    expect(screen.getByTestId('media-status').textContent).not.toContain(':')
    Object.defineProperty(audio, 'duration', { value: 95.4, configurable: true })
    fireEvent(audio, new Event('loadedmetadata'))
    expect(screen.getByTestId('media-status').textContent).toContain('1:35')
  })

  it('时长为 Infinity / NaN（流式或损坏）时不显示时长，不崩', () => {
    render(<MediaView path="音/坏.mp3" url="u" kind="audio" />)
    const audio = screen.getByTestId('media-audio')
    Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true })
    fireEvent(audio, new Event('loadedmetadata'))
    expect(screen.getByTestId('media-status').textContent).toContain('音/坏.mp3')
    expect(screen.getByTestId('media-status').textContent).not.toContain(':')
  })

  it('加载失败 → 占位文案', () => {
    render(<MediaView path="音/缺失.mp3" url="u" kind="audio" />)
    fireEvent.error(screen.getByTestId('media-audio'))
    expect(screen.getByText('无法加载此资源')).toBeTruthy()
    expect(screen.queryByTestId('media-audio')).toBeNull()
  })
})
