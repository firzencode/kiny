/**
 * 生效绑定合成（覆盖 ?? 默认）+ 单一命名空间冲突检测 + 分域派发表（纯函数）。
 */
import { COMMANDS, isRebindable, type CommandId, type CommandDef } from './registry'
import { isBindable } from './keys'

export type Overrides = Partial<Record<CommandId, string>>

/** 生效绑定 = 覆盖 ?? 默认；覆盖仅对可重绑命令、且须过可绑校验，否则回落默认。 */
export function effectiveKeys(overrides: Overrides = {}): Map<CommandId, string> {
  const m = new Map<CommandId, string>()
  for (const c of COMMANDS) {
    const ov = overrides[c.id]
    m.set(c.id, ov && isRebindable(c.id) && isBindable(ov).ok ? ov : c.defaultKeys)
  }
  return m
}

export interface EffectiveBinding {
  id: CommandId
  keys: string
  def: CommandDef
}

/** 生效绑定列表（带定义，展示序同 COMMANDS）。 */
export function effectiveBindings(overrides: Overrides = {}): EffectiveBinding[] {
  const eff = effectiveKeys(overrides)
  return COMMANDS.map((c) => ({ id: c.id, keys: eff.get(c.id)!, def: c }))
}

/** 冲突：同一组合被 >1 命令占用（含 readonly，单一命名空间跨 global/editor）。keys → 命令 id 列表。 */
export function detectConflicts(overrides: Overrides = {}): Map<string, CommandId[]> {
  const byKey = new Map<string, CommandId[]>()
  for (const [id, keys] of effectiveKeys(overrides)) {
    if (!byKey.has(keys)) byKey.set(keys, [])
    byKey.get(keys)!.push(id)
  }
  const out = new Map<string, CommandId[]>()
  for (const [keys, ids] of byKey) if (ids.length > 1) out.set(keys, ids)
  return out
}

/** 若把某组合赋给某命令，返回已占用它的其它命令 id（含 readonly）；无冲突返回 null。 */
export function commandUsing(keys: string, exceptId: CommandId, overrides: Overrides = {}): CommandId | null {
  for (const [id, k] of effectiveKeys(overrides)) {
    if (id !== exceptId && k === keys) return id
  }
  return null
}

/** 某域「组合 → 命令 id」派发表；跳过 readonly（原生处理）与冲突（保留首个）。 */
export function dispatchMap(scope: 'global' | 'editor', overrides: Overrides = {}): Map<string, CommandId> {
  const eff = effectiveKeys(overrides)
  const m = new Map<string, CommandId>()
  for (const c of COMMANDS) {
    if (c.scope !== scope || c.readonly) continue
    const keys = eff.get(c.id)!
    if (!m.has(keys)) m.set(keys, c.id)
  }
  return m
}
