import { createInterface } from 'node:readline'

/** 终端 IO 缝：write 输出一行，readLine 显示 prompt 读一行。color 决定是否输出 ANSI。 */
export interface Term {
  readonly color: boolean
  write(s: string): void
  readLine(prompt: string): Promise<string>
}

/** 真终端实现（不测薄壳）：readline + stdout；isTTY 时启用颜色。 */
export function makeTerminal(): Term {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    color: process.stdout.isTTY === true,
    write: (s) => process.stdout.write(s + '\n'),
    readLine: (prompt) => new Promise((resolve) => rl.question(prompt, resolve)),
  }
}
