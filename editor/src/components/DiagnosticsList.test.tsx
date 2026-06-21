import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiagnosticsList } from './DiagnosticsList'
import type { Diagnostic } from '@kiny/engine'

const diags: Diagnostic[] = [
  { severity: 'error', code: 'e1', message: '跳转缺目标', file: '结局.kin', line: 3 },
  { severity: 'warning', code: 'w1', message: '未使用变量', file: 'main.kin', line: 5 },
]

describe('DiagnosticsList', () => {
  it('列出诊断，点击以 (file, line) 回调 onJump', async () => {
    const onJump = vi.fn()
    render(<DiagnosticsList diagnostics={diags} onJump={onJump} />)
    expect(screen.getByText(/跳转缺目标/)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/跳转缺目标/))
    expect(onJump).toHaveBeenCalledWith('结局.kin', 3)
  })

  it('无诊断时显示「无错误」', () => {
    render(<DiagnosticsList diagnostics={[]} onJump={vi.fn()} />)
    expect(screen.getByText('无错误')).toBeInTheDocument()
  })
})
