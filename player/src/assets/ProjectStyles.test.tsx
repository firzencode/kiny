import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ProjectStyles } from './ProjectStyles'

describe('ProjectStyles', () => {
  it('渲染为单个 <style>，内容原样', () => {
    const { container } = render(<ProjectStyles css=".player{color:red}" />)
    const styles = container.querySelectorAll('style')
    expect(styles).toHaveLength(1)
    expect(styles[0]!.textContent).toBe('.player{color:red}')
  })

  it('空串不渲染（无资源项目零副作用）', () => {
    const { container } = render(<ProjectStyles css="" />)
    expect(container.querySelector('style')).toBeNull()
  })

  it('重渲染同一内容仍只有一个 style（幂等，不重复注入）', () => {
    const { container, rerender } = render(<ProjectStyles css="a{}" />)
    rerender(<ProjectStyles css="a{}" />)
    expect(container.querySelectorAll('style')).toHaveLength(1)
  })
})
