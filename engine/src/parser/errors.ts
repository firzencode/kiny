/** 解析期语法错误，带 1 起行号与可选文件路径 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly path?: string,
  ) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'ParseError'
  }
}
