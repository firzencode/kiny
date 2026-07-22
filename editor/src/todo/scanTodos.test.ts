import { describe, it, expect } from 'vitest'
import { scanTodos, groupTodosByFile } from './scanTodos'

const scan = (text: string) => scanTodos([{ path: 'a.kin', text }])

describe('scanTodos', () => {
  it('识别 Kin 注释区 // TODO / // FIXME', () => {
    const r = scan('正文\n// TODO 补写这条分支\n// FIXME: 这里有 bug')
    expect(r).toEqual([
      { path: 'a.kin', line: 2, tag: 'TODO', text: '补写这条分支' },
      { path: 'a.kin', line: 3, tag: 'FIXME', text: '这里有 bug' },
    ])
  })

  it('识别 JS 区（~ 行 / ~~~ 块）里的 // TODO', () => {
    const r = scan('~ let x = 1 // TODO 调参\n~~~\nlet y = 2 // FIXME 溢出\n~~~')
    expect(r.map((t) => [t.line, t.tag, t.text])).toEqual([
      [1, 'TODO', '调参'],
      [3, 'FIXME', '溢出'],
    ])
  })

  it('识别单行块注释 /* TODO ... */，去尾 */', () => {
    const r = scan('/* TODO 稍后处理 */')
    expect(r).toEqual([{ path: 'a.kin', line: 1, tag: 'TODO', text: '稍后处理' }])
  })

  it('半角/全角冒号、无冒号、无文本均可', () => {
    expect(scan('// TODO: 甲')[0]!.text).toBe('甲')
    expect(scan('// TODO：乙')[0]!.text).toBe('乙')
    expect(scan('// TODO 丙')[0]!.text).toBe('丙')
    expect(scan('// TODO')[0]!.text).toBe('')
  })

  it('大小写敏感：小写 todo / 普通注释 / 普通文本不误收', () => {
    expect(scan('// todo 小写不收')).toEqual([])
    expect(scan('// 普通注释')).toEqual([])
    expect(scan('这是一段包含 TODO 字样的正文')).toEqual([]) // 无 // 或 /* 紧邻
    expect(scan('// 里面提到 TODO 但不紧跟')).toEqual([]) // // 后紧跟的是「里面」非 TODO
  })

  it('行号准（含空行）', () => {
    const r = scan('\n\n// TODO 第三行\n\n// FIXME 第五行')
    expect(r.map((t) => t.line)).toEqual([3, 5])
  })

  it('只扫 .kin，跳过其它资源', () => {
    const r = scanTodos([
      { path: 'a.kin', text: '// TODO 收' },
      { path: 'style.css', text: '/* TODO 不收 */' },
    ])
    expect(r.map((t) => t.path)).toEqual(['a.kin'])
  })

  it('多文件汇总稳定排序：path 字典序 + line 升序', () => {
    const r = scanTodos([
      { path: 'z.kin', text: '// TODO z1\n// TODO z2' },
      { path: 'a.kin', text: '// FIXME a1' },
    ])
    expect(r.map((t) => [t.path, t.line])).toEqual([
      ['a.kin', 1],
      ['z.kin', 1],
      ['z.kin', 2],
    ])
  })

  it('groupTodosByFile 按文件分组、保序', () => {
    const items = scanTodos([
      { path: 'a.kin', text: '// TODO a1\n// TODO a2' },
      { path: 'b.kin', text: '// TODO b1' },
    ])
    const g = groupTodosByFile(items)
    expect(g.map((x) => [x.path, x.items.length])).toEqual([
      ['a.kin', 2],
      ['b.kin', 1],
    ])
  })
})
