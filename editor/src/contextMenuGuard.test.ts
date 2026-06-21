import { it, expect } from 'vitest'
import { installContextMenuGuard } from './contextMenuGuard'

it('屏蔽原生右键菜单：阻止 contextmenu 默认行为', () => {
  const el = document.createElement('div')
  installContextMenuGuard(el)
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  expect(ev.defaultPrevented).toBe(true)
})
