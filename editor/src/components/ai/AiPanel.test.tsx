import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiPanel, type AiPanelProps } from './AiPanel'

const base: AiPanelProps = {
  configured: true, model: 'deepseek-chat', turns: [], running: false,
  onSend: vi.fn(), onStop: vi.fn(), onNewConversation: vi.fn(), onClose: vi.fn(), onOpenSettings: vi.fn(),
  conversations: [], currentId: null, onSelectConversation: vi.fn(), onDeleteConversation: vi.fn(),
}

describe('AiPanel', () => {
  it('未配置：显示空态与「前往设置」，输入禁用', () => {
    const onOpenSettings = vi.fn()
    render(<AiPanel {...base} configured={false} onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(onOpenSettings).toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('Enter 发送非空输入，Shift+Enter 不发送', () => {
    const onSend = vi.fn()
    render(<AiPanel {...base} onSend={onSend} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: '帮我写一个开头' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('帮我写一个开头')
  })

  it('运行中显示停止按钮，点击调 onStop', () => {
    const onStop = vi.fn()
    render(<AiPanel {...base} running={true} onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('传 onResize 时渲染宽度拖拽分隔条；省略则不渲染', () => {
    const { rerender } = render(<AiPanel {...base} onResize={vi.fn()} />)
    expect(screen.getByRole('separator', { name: '调整 AI 面板宽度' })).toBeInTheDocument()
    rerender(<AiPanel {...base} />)
    expect(screen.queryByRole('separator', { name: '调整 AI 面板宽度' })).toBeNull()
  })

  it('渲染 turn：用户气泡 + 思考 + AI 叙述 + 工具调用名（按片段顺序）', () => {
    render(<AiPanel {...base} turns={[{
      id: 1, prompt: '加个老板节点', running: false,
      segments: [
        { kind: 'think', text: '先看看现有结构' },
        { kind: 'say', text: '我来新建节点。' },
        { kind: 'tool', record: { call: { id: 'c1', name: 'createFile', arguments: {} }, result: '{}', ok: true } },
        { kind: 'say', text: '已加好。' },
      ],
    }]} />)
    expect(screen.getByText('加个老板节点')).toBeInTheDocument()
    expect(screen.getByText('先看看现有结构')).toBeInTheDocument()
    expect(screen.getByText('已加好。')).toBeInTheDocument()
    expect(screen.getByText('createFile')).toBeInTheDocument()
  })

  it('对话历史：⟲ 展开列表，点条目切换、点 🗑 删除', () => {
    const onSelect = vi.fn()
    const onDelete = vi.fn()
    const convs = [
      { id: 'b', title: '较新的对话', lastActivityAt: 200 },
      { id: 'a', title: '较旧的对话', lastActivityAt: 100 },
    ]
    render(<AiPanel {...base} conversations={convs} currentId="b" onSelectConversation={onSelect} onDeleteConversation={onDelete} />)
    // 默认不显示历史
    expect(screen.queryByText('较旧的对话')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '对话历史' }))
    expect(screen.getByText('较新的对话')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('较旧的对话'))
    expect(onSelect).toHaveBeenCalledWith('a')
    // 重新展开后删除
    fireEvent.click(screen.getByRole('button', { name: '对话历史' }))
    fireEvent.click(screen.getByRole('button', { name: '删除对话 较新的对话' }))
    expect(onDelete).toHaveBeenCalledWith('b')
  })

  it('对话历史：空列表显示占位文案', () => {
    render(<AiPanel {...base} conversations={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '对话历史' }))
    expect(screen.getByText('暂无历史对话')).toBeInTheDocument()
  })

  it('say 片段按 Markdown 渲染（加粗 / 列表）', () => {
    const { container } = render(<AiPanel {...base} turns={[{
      id: 1, prompt: 'x', running: false,
      segments: [{ kind: 'say', text: '**重点**\n\n- 一\n- 二' }],
    }]} />)
    expect(container.querySelector('.msg-ai .body strong')?.textContent).toBe('重点')
    expect(container.querySelectorAll('.msg-ai .body li')).toHaveLength(2)
  })
})
