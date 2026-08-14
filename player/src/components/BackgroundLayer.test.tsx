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
  // 遮罩（--kiny-bg-overlay）是**底图的**色罩：没有底图就没有遮罩，页面底色即 --kiny-page-bg
  // 的字面值。这两条把该契约钉死——回归会让所有浅色主题的底色再次发灰（issue IK8MSN）。
  it('有 src 时渲染遮罩层，且该层不在 .bg-layer 之内', () => {
    const { getByTestId, queryByTestId } = render(<BackgroundLayer src="demo/assets/a.jpg" />)
    expect(queryByTestId('bg-overlay')).not.toBeNull()
    // 契约的另一半：遮罩必须在 .bg-layer **之外**。挪进去（哪怕作子元素）就会被那一层的
    // filter: brightness() 连带压暗，作者写的 --kiny-bg-overlay 又不等于实际罩色。
    expect(getByTestId('bg-layer').contains(getByTestId('bg-overlay'))).toBe(false)
  })
  it('src 为 null 时不渲染遮罩层', () => {
    const { queryByTestId } = render(<BackgroundLayer src={null} />)
    expect(queryByTestId('bg-overlay')).toBeNull()
  })
})
