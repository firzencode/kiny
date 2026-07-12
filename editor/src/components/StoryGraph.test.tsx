import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// jsdom 的 PointerEvent 不透传 clientX/clientY/buttons，需手动注入到原生事件上，
// React 合成事件才能从 nativeEvent 读到这些值（否则 e.clientX 为 undefined → 平移算成 NaN）。
function firePointer(
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
  el: Element,
  props: { clientX?: number; clientY?: number; buttons?: number },
) {
  const ev = createEvent[type](el, { pointerId: 1 })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(ev, k, { get: () => v })
  fireEvent(el, ev)
}
import { parse, analyze } from '@kiny/engine'
import type { ProjectFile, ValidatedProgram } from '@kiny/engine'
import { StoryGraph } from './StoryGraph'

function programOf(sources: Record<string, string>): ValidatedProgram {
  const files: ProjectFile[] = Object.entries(sources).map(([path, src]) => parse(src, path))
  const { program } = analyze(files)
  if (!program) throw new Error('fixture 应无校验错误')
  return program
}

const STORY = {
  'main.kin': ['开场白。', '-> 甲', '=== 甲 ===', '* [去乙] -> 乙', '=== 乙 ===', '-> END'].join('\n'),
}

describe('StoryGraph', () => {
  it('program 为 null → 占位提示', () => {
    render(<StoryGraph program={null} activeLine={1} onJump={() => {}} />)
    expect(screen.getByText(/修复错误后显示/)).toBeInTheDocument()
  })

  it('渲染各 knot 节点标题与 END 终端', () => {
    const program = programOf(STORY)
    render(<StoryGraph program={program} entryPath="main.kin" activeLine={1} onJump={() => {}} />)
    expect(screen.getByText('甲')).toBeInTheDocument()
    expect(screen.getByText('乙')).toBeInTheDocument()
    expect(screen.getByText('END')).toBeInTheDocument()
    expect(screen.getByText('（开场）')).toBeInTheDocument()
  })

  it('点击节点 → onJump(file, line)', async () => {
    const program = programOf(STORY)
    const onJump = vi.fn()
    render(<StoryGraph program={program} entryPath="main.kin" activeLine={1} onJump={onJump} />)
    await userEvent.click(screen.getByText('甲'))
    expect(onJump).toHaveBeenCalledWith('main.kin', 3) // 甲 在第 3 行
  })

  it('点击 stitch 子节点 → onJump 到子节点行', async () => {
    const program = programOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '正文。', '= 子', '子正文。', '-> END'].join('\n'),
    })
    const onJump = vi.fn()
    render(<StoryGraph program={program} entryPath="main.kin" activeLine={1} onJump={onJump} />)
    await userEvent.click(screen.getByText('子'))
    expect(onJump).toHaveBeenCalledWith('main.kin', 4) // 子 在第 4 行
  })

  it('入口节点带 entry 标记', () => {
    const program = programOf(STORY)
    const { container } = render(
      <StoryGraph program={program} entryPath="main.kin" activeLine={1} onJump={() => {}} />,
    )
    // 入口 = 开场 knot
    const entry = container.querySelector('.graph-node.entry')
    expect(entry).toBeTruthy()
    expect(entry!.classList.contains('opening')).toBe(true)
  })

  it('activeLine 落入某 knot → 该节点高亮', () => {
    const program = programOf(STORY)
    const { container } = render(
      <StoryGraph program={program} entryPath="main.kin" activeFile="main.kin" activeLine={4} onJump={() => {}} />,
    )
    // 第 4 行属 knot 甲（3 行起），乙 在 5 行 → 高亮甲
    const jia = container.querySelector('[data-node-id="甲"]')
    expect(jia!.classList.contains('active')).toBe(true)
    const yi = container.querySelector('[data-node-id="乙"]')
    expect(yi!.classList.contains('active')).toBe(false)
  })

  it('丢失 pointerup 后无按键移动不再平移（拖拽跟随回归）', () => {
    const program = programOf(STORY)
    const { container } = render(
      <StoryGraph program={program} entryPath="main.kin" activeLine={1} onJump={() => {}} />,
    )
    const svg = container.querySelector('.graph-svg')!
    const panGroup = container.querySelector('g[transform]')!

    // 背景按下并拖动（按住主键）→ 平移生效。
    firePointer('pointerDown', svg, { clientX: 100, clientY: 100, buttons: 1 })
    firePointer('pointerMove', svg, { clientX: 140, clientY: 120, buttons: 1 })
    // 默认 view {tx:24,ty:24}，位移 (+40,+20) → {tx:64,ty:44}
    expect(panGroup.getAttribute('transform')).toBe('translate(64 44) scale(1)')

    // 模拟丢失 pointerup：不发 up，直接来一个无按键的移动（普通 hover）→ 不应再平移。
    firePointer('pointerMove', svg, { clientX: 260, clientY: 260, buttons: 0 })
    expect(panGroup.getAttribute('transform')).toBe('translate(64 44) scale(1)')
  })

  it('缩放/适配工具条按钮存在', () => {
    const program = programOf(STORY)
    render(<StoryGraph program={program} entryPath="main.kin" activeLine={1} onJump={() => {}} />)
    expect(screen.getByLabelText('放大')).toBeInTheDocument()
    expect(screen.getByLabelText('缩小')).toBeInTheDocument()
    expect(screen.getByLabelText('适配画布')).toBeInTheDocument()
  })
})
