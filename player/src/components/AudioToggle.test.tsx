import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AudioToggle } from './AudioToggle'

describe('AudioToggle', () => {
  it('点击在静音/有声间切换回调', async () => {
    const onToggle = vi.fn()
    render(<AudioToggle muted={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
  it('muted 时显示静音图标', () => {
    render(<AudioToggle muted={true} onToggle={() => {}} />)
    expect(screen.getByRole('button').textContent).toContain('🔇')
  })
})
