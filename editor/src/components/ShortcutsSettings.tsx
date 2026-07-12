import { useState } from 'react'
import type { ShortcutOverrides } from '../state/settings'
import { effectiveBindings, commandUsing, detectConflicts } from '../shortcuts/bindings'
import { getCommand, type CommandId } from '../shortcuts/registry'
import { format, isMac, normalize, isBindable } from '../shortcuts/keys'

/**
 * 快捷键设置页（SettingsDialog 第 5 tab）。分组速查全部命令 + 点击捕获新组合 +
 * 冲突检测（占用即阻止，不自动抢占）+ 逐项 / 全部恢复默认。readonly 原生键只展示。
 */
export function ShortcutsSettings({
  overrides,
  onChange,
}: {
  overrides: ShortcutOverrides
  onChange: (next: ShortcutOverrides) => void
}) {
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mac = isMac()

  const bindings = effectiveBindings(overrides)
  // 残留冲突（含恢复默认后与他命令覆盖撞车的情形）：捕获时已挡新冲突，但 reset / 全部恢复
  // 可能让某命令回到已被他人占用的默认键，dispatchMap 仅首个生效——在此显式暴露、标红提示。
  const conflicts = detectConflicts(overrides)
  const conflictIds = new Set<CommandId>()
  for (const ids of conflicts.values()) for (const id of ids) conflictIds.add(id)
  // 按 category 分组，保序。
  const groups: { category: string; items: typeof bindings }[] = []
  for (const b of bindings) {
    let g = groups.find((x) => x.category === b.def.category)
    if (!g) {
      g = { category: b.def.category, items: [] }
      groups.push(g)
    }
    g.items.push(b)
  }

  const applyCapture = (id: CommandId, e: React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setCapturing(null)
      setError(null)
      return
    }
    const combo = normalize(e)
    if (!combo) return // 纯修饰键，继续等
    const chk = isBindable(combo)
    if (!chk.ok) {
      setError(chk.reason ?? '无效组合')
      return
    }
    const occupied = commandUsing(combo, id, overrides)
    if (occupied) {
      setError(`该组合已被「${getCommand(occupied).label}」占用，请先改 / 清除对方`)
      return
    }
    const next: ShortcutOverrides = { ...overrides }
    if (combo === getCommand(id).defaultKeys) delete next[id]
    else next[id] = combo
    onChange(next)
    setCapturing(null)
    setError(null)
  }

  const resetOne = (id: CommandId) => {
    const next: ShortcutOverrides = { ...overrides }
    delete next[id]
    onChange(next)
    if (capturing === id) setCapturing(null)
    setError(null)
  }

  return (
    <div className="shortcuts-settings">
      <div className="shortcuts-head">
        <p className="settings-hint">点击某项的快捷键可捕获新组合；组合须带 Ctrl/⌘/Alt（F1–F12 除外），冲突时阻止。</p>
        <button
          type="button"
          className="shortcuts-reset-all"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => {
            onChange({})
            setCapturing(null)
            setError(null)
          }}
        >
          全部恢复默认
        </button>
      </div>
      {error && <div className="shortcuts-error" role="alert">{error}</div>}
      {conflicts.size > 0 && (
        <div className="shortcuts-conflict" role="alert">
          <div className="shortcuts-conflict-head">以下快捷键存在冲突（同一组合被多个命令占用，仅首个生效）：</div>
          <ul>
            {[...conflicts].map(([keys, ids]) => (
              <li key={keys}>
                <span className="shortcuts-conflict-key">{format(keys, mac)}</span>
                {' '}
                {ids.map((id) => getCommand(id).label).join(' / ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.category} className="shortcuts-group">
          <div className="shortcuts-group-title">{g.category}</div>
          <ul className="shortcuts-list">
            {g.items.map((b) => {
              const overridden = overrides[b.id] != null
              const readonly = b.def.readonly
              const isCap = capturing === b.id
              const conflicted = conflictIds.has(b.id)
              return (
                <li key={b.id} className={'shortcut-row' + (readonly ? ' readonly' : '') + (conflicted ? ' conflict' : '')}>
                  <span className="shortcut-label">{b.def.label}</span>
                  {readonly ? (
                    <span className="shortcut-keys readonly" aria-label={`${b.def.label} 快捷键（不可改）`}>
                      {format(b.keys, mac)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={'shortcut-keys' + (isCap ? ' capturing' : '') + (overridden ? ' overridden' : '')}
                      aria-label={`修改「${b.def.label}」快捷键`}
                      onClick={() => {
                        setCapturing(b.id)
                        setError(null)
                      }}
                      onKeyDown={isCap ? (e) => applyCapture(b.id, e) : undefined}
                    >
                      {isCap ? '按下新组合…' : format(b.keys, mac)}
                    </button>
                  )}
                  {!readonly && overridden && (
                    <button
                      type="button"
                      className="shortcut-reset"
                      aria-label={`「${b.def.label}」恢复默认`}
                      onClick={() => resetOne(b.id)}
                    >
                      ↺
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
