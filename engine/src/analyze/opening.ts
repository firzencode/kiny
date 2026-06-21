import type { ProjectFile, Knot } from '../parser/ast'
import type { ValidatedProgram } from './types'

/**
 * 开场 knot 的保留合成名：含前导空格。节点头解析会 trim 首尾空白、validateNodeName 拒绝含空白的名字，
 * 故任何作者声明的 knot 名都不可能等于它 —— 语法上无法产生，不会撞名。按文件路径唯一。
 */
export function openingKnotName(path: string): string {
  return ' opening:' + path
}

/** 为每个 preamble 非空的文件，合成一个作用域为全局的开场 knot，加进 knots Map（不动 file.knots）。 */
export function addOpeningKnots(knots: Map<string, Knot>, files: ProjectFile[]): void {
  for (const file of files) {
    if (file.preamble.length === 0) continue
    const name = openingKnotName(file.path)
    const opening: Knot = {
      kind: 'knot',
      name,
      params: [],
      body: file.preamble,
      stitches: [],
      line: file.preamble[0]!.line,
      scope: 'global',
    }
    knots.set(name, opening)
  }
}

/** 解析入口起点：入口文件有 preamble → 其开场 knot 名；否则第一个显式 knot 名；都没有 → null。供 CLI/reader 复用。 */
export function resolveStart(program: ValidatedProgram, entryPath: string): string | null {
  const file = program.files.find((f) => f.path === entryPath)
  if (!file) return null
  if (file.preamble.length > 0) {
    const name = openingKnotName(entryPath)
    if (program.knots.has(name)) return name
  }
  return file.knots[0]?.name ?? null
}
