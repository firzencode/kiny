import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BackgroundLayer } from './BackgroundLayer'

describe('BackgroundLayer', () => {
  it('有 src 时渲染带该背景图的图层', () => {
    const { getByTestId } = render(<BackgroundLayer src="demo/assets/a.jpg" />)
    expect(getByTestId('bg-layer').style.backgroundImage).toContain('demo/assets/a.jpg')
  })
  it('src 为 null 时背景图为空', () => {
    const { getByTestId } = render(<BackgroundLayer src={null} />)
    expect(getByTestId('bg-layer').style.backgroundImage).toBe('')
  })
})
