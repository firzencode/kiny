import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CharacterEditor } from './CharacterEditor'

const RAW = <div>原文编辑器</div>

/**
 * 受控壳：把 onChange 回写成新的 source，模拟 App 里「改缓冲 → 重渲染」的真实闭环。
 * 不回写的话组件永远拿着旧文本，改完名字后的界面反馈（如同名标签警告）根本不会出现。
 */
function setup(initial: string) {
  const onChange = vi.fn()
  function Harness() {
    const [source, setSource] = useState(initial)
    return (
      <CharacterEditor
        source={source}
        onChange={(s) => { onChange(s); setSource(s) }}
        rawEditor={RAW}
      />
    )
  }
  render(<Harness />)
  return { onChange }
}

/** 改一个名字输入框的值并提交（DraftInput 是失焦才提交）。 */
async function rename(index: number, next: string) {
  const inputs = screen.getAllByRole('textbox')
  const el = inputs[index]!
  await userEvent.clear(el)
  await userEvent.type(el, next)
  await userEvent.tab()
}

describe('CharacterEditor', () => {
  it('正常 JSON 渲染出对应行数与名字', () => {
    setup('{"甲":{},"乙":{"color":"#7fb3d5"}}')
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.map((el) => (el as HTMLInputElement).value)).toEqual(['甲', '乙'])
  })

  it('改名字后 onChange 收到保序的新 JSON', async () => {
    const { onChange } = setup('{"甲":{},"乙":{"color":"#7fb3d5"}}')
    await rename(0, '丙')
    expect(onChange).toHaveBeenCalledWith('{\n  "丙": {},\n  "乙": {\n    "color": "#7fb3d5"\n  }\n}\n')
  })

  it('重名被拒收：不写回文件，并给出错误提示', async () => {
    const { onChange } = setup('{"甲":{},"乙":{}}')
    await rename(0, '乙')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/已经有同名角色/)
  })

  it('名字含禁用字符被拒收', async () => {
    const { onChange } = setup('{"甲":{}}')
    await rename(0, 'a:b')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/不能含/)
  })

  it('角色名叫 b：只是警告，照常写回', async () => {
    const { onChange } = setup('{"甲":{}}')
    await rename(0, 'b')
    expect(onChange).toHaveBeenCalledWith('{\n  "b": {}\n}\n')
    expect(screen.getByRole('status').textContent).toMatch(/与内置富文本标签同名/)
  })

  it('JSON 写坏 → GUI 停用并提示切「原文」，「原文」页仍可用', async () => {
    setup('{坏 json')
    expect(screen.getByRole('alert').textContent).toMatch(/看不懂/)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    await userEvent.click(screen.getByRole('tab', { name: '原文' }))
    expect(screen.getByText('原文编辑器')).toBeInTheDocument()
  })

  it('添加角色 / 删除角色写回整表', async () => {
    const { onChange } = setup('{"甲":{}}')
    await userEvent.click(screen.getByRole('button', { name: /添加角色/ }))
    expect(onChange).toHaveBeenLastCalledWith('{\n  "甲": {},\n  "角色2": {}\n}\n')
    await userEvent.click(screen.getByRole('button', { name: '删除甲' }))
    expect(onChange).toHaveBeenLastCalledWith('{\n  "角色2": {}\n}\n')
    await userEvent.click(screen.getByRole('button', { name: '删除角色2' }))
    expect(onChange).toHaveBeenLastCalledWith('{}\n')
  })

  it('上移 / 下移换顺序（顺序即自动配色的槽位）', async () => {
    const { onChange } = setup('{"甲":{},"乙":{}}')
    await userEvent.click(screen.getByRole('button', { name: '把乙上移' }))
    expect(onChange).toHaveBeenLastCalledWith('{\n  "乙": {},\n  "甲": {}\n}\n')
  })

  it('点「改用固定色」→ 钉住本槽位的近似色（不是凭空一个灰）', async () => {
    const { onChange } = setup('{"甲":{}}')
    await userEvent.click(screen.getByRole('button', { name: '改用固定色' }))
    expect(onChange).toHaveBeenLastCalledWith('{\n  "甲": {\n    "color": "#e790ab"\n  }\n}\n')
  })

  it('文件里已有不合法的名字 → 给出提示，但不锁死编辑', async () => {
    setup('{"甲":{},"":{}}')
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '')
    expect(alerts.some((t) => t.includes('个角色名不合法') && t.includes('这些角色不会生效'))).toBe(true)
  })

  /**
   * 这条锁的是「作者能不能把坏文件改好」。若整表因为任一坏名字就拒绝写回，页面会陷进死循环：
   * 改动写不回去 → 文件不变 → 重算出的行还是原样 → 一个坏名字也修不掉。
   */
  it('多个坏名字可以逐个改好（每改一个都真的写回文件）', async () => {
    const { onChange } = setup('{"1":{},"2":{}}') // 两个纯数字名，都会打乱键顺序
    await rename(0, '一号')
    // 「2」是整数键、写回时被 JSON 排到最前，这是纯数字名不合法的原因，作者当场看得见
    expect(onChange).toHaveBeenLastCalledWith('{\n  "2": {},\n  "一号": {}\n}\n')
    await rename(0, '二号') // 此刻第 0 行已经是「2」
    expect(onChange).toHaveBeenLastCalledWith('{\n  "二号": {},\n  "一号": {}\n}\n')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('重名是唯一会拦住写回的情形（写回会把两行折成一条、丢掉一个角色）', async () => {
    const { onChange } = setup('{"甲":{},"乙":{}}')
    await rename(0, '乙')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('点「改回自动」→ 清空 color', async () => {
    const { onChange } = setup('{"乙":{"color":"#7fb3d5"}}')
    await userEvent.click(screen.getByRole('button', { name: '改回自动' }))
    expect(onChange).toHaveBeenLastCalledWith('{\n  "乙": {}\n}\n')
  })

  it('写回幂等：值没变不触发 onChange（免幻影脏标记）', async () => {
    const { onChange } = setup('{\n  "甲": {}\n}\n')
    await rename(0, '甲')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('AI 运行期（readOnly）禁用全部控件', () => {
    const onChange = vi.fn()
    render(<CharacterEditor source='{"甲":{}}' onChange={onChange} readOnly rawEditor={RAW} />)
    expect(screen.getAllByRole('textbox')[0]).toBeDisabled()
    expect(screen.getByRole('button', { name: /添加角色/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除甲' })).toBeDisabled()
  })
})
