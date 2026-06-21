import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outline } from './Outline'
import type { NodeInfo } from '../syntax/kin'

const nodes: NodeInfo[] = [
  { name: '开场', line: 4, diverts: 1 },
  { name: '出发前', line: 7, diverts: 2 },
  { name: '末', line: 12, diverts: 1 },
]

describe('Outline', () => {
  it('列出全部节点名，点击以行号回调 onJump', async () => {
    const onJump = vi.fn()
    render(<Outline nodes={nodes} activeLine={1} onJump={onJump} />)
    expect(screen.getByText('开场')).toBeInTheDocument()
    expect(screen.getByText('出发前')).toBeInTheDocument()
    await userEvent.click(screen.getByText('出发前'))
    expect(onJump).toHaveBeenCalledWith(7)
  })

  it('activeLine 落在某节点区间 → 该节点高亮 active', () => {
    render(<Outline nodes={nodes} activeLine={8} onJump={vi.fn()} />)
    const li = screen.getByText('出发前').closest('li')
    expect(li).toHaveClass('active')
    expect(screen.getByText('开场').closest('li')).not.toHaveClass('active')
  })

  it('无节点 → 占位「尚无节点」', () => {
    render(<Outline nodes={[]} activeLine={1} onJump={vi.fn()} />)
    expect(screen.getByText('尚无节点')).toBeInTheDocument()
  })
})
