import { describe, it, expect } from 'vitest'
import { parseRows, formatRows, nameIssue, canCommit, type CharacterRow } from './model'

describe('parseRows', () => {
  it('保序读出角色与颜色', () => {
    expect(parseRows('{"甲":{},"乙":{"color":"#7fb3d5"}}')).toEqual({
      ok: true,
      rows: [{ name: '甲', color: '' }, { name: '乙', color: '#7fb3d5' }],
    })
  })

  it('空文本 = 空表（刚新建的文件也能开 GUI）', () => {
    expect(parseRows('')).toEqual({ ok: true, rows: [] })
    expect(parseRows('   \n')).toEqual({ ok: true, rows: [] })
    expect(parseRows('{}')).toEqual({ ok: true, rows: [] })
  })

  it('非法 JSON / 非对象顶层 → 不 ok（GUI 停用，绝不猜着写回）', () => {
    expect(parseRows('{坏').ok).toBe(false)
    expect(parseRows('[]').ok).toBe(false)
    expect(parseRows('"x"').ok).toBe(false)
    expect(parseRows('null').ok).toBe(false)
  })

  it('值形状不对 / 有不认识的字段 → 不 ok（不能把作者手写的东西覆盖掉）', () => {
    expect(parseRows('{"甲":"红"}').ok).toBe(false)
    expect(parseRows('{"甲":{"色":"红"}}').ok).toBe(false)
    expect(parseRows('{"甲":{"color":42}}').ok).toBe(false)
  })
})

describe('formatRows', () => {
  it('写回保序、两空格缩进、空颜色写成空对象', () => {
    expect(formatRows([{ name: '甲', color: '' }, { name: '乙', color: '#7fb3d5' }]))
      .toBe('{\n  "甲": {},\n  "乙": {\n    "color": "#7fb3d5"\n  }\n}\n')
  })

  it('往返幂等', () => {
    const src = formatRows([{ name: '甲', color: '' }, { name: '乙', color: '#7fb3d5' }])
    const r = parseRows(src)
    expect(r.ok && formatRows(r.rows)).toBe(src)
  })

  it('空表写成空对象', () => {
    expect(formatRows([])).toBe('{}\n')
  })
})

describe('nameIssue', () => {
  const rows: CharacterRow[] = [{ name: '甲', color: '' }, { name: '乙', color: '' }]

  it('空名字是错误', () => {
    expect(nameIssue('', rows, 0)?.level).toBe('error')
    expect(nameIssue('   ', rows, 0)?.level).toBe('error')
  })

  it('含禁用字符是错误', () => {
    for (const n of ['a<b', 'a>b', 'a:b', 'a：b']) expect(nameIssue(n, rows, 0)?.level).toBe('error')
  })

  // 整数形态的 JSON 键会被 Object.entries / JSON.stringify 提到最前按数值排，
  // 「键顺序即声明顺序即配色槽位」这条不变量在它们身上失效。
  it('纯数字名是错误（会打乱键顺序）', () => {
    for (const n of ['7', '42', '0']) expect(nameIssue(n, rows, 0)?.level).toBe('error')
    expect(nameIssue('7号', rows, 0)).toBeNull()
    expect(nameIssue('机器人7', rows, 0)).toBeNull()
  })

  it('与别的角色重名是错误（不含自己）', () => {
    expect(nameIssue('乙', rows, 0)?.level).toBe('error')
    expect(nameIssue('甲', rows, 0)).toBeNull()
  })

  it('与内置自闭合标签同名 → 警告：尖括号写法不生效', () => {
    for (const n of ['br', 'pause']) {
      const issue = nameIssue(n, rows, 0)
      expect(issue?.level).toBe('warning')
      expect(issue?.message).toMatch(/尖括号写法不生效/)
    }
  })

  it('与内置成对标签同名 → 警告里说明「校验会报错」（未闭合标签，比不着色更严重）', () => {
    for (const n of ['b', 'i', 'u', 's']) {
      const issue = nameIssue(n, rows, 0)
      expect(issue?.level).toBe('warning')
      expect(issue?.message).toMatch(/没闭合.*校验直接报错/)
    }
  })

  it('错误优先于警告（叫 b 又重名 → 先报重名）', () => {
    const dup: CharacterRow[] = [{ name: 'b', color: '' }, { name: 'b', color: '' }]
    expect(nameIssue('b', dup, 0)?.level).toBe('error')
  })

  it('正常名字无问题', () => {
    expect(nameIssue('丙', rows, 0)).toBeNull()
  })
})

describe('canCommit', () => {
  it('只拦重名——那是唯一会丢角色的写回', () => {
    expect(canCommit([{ name: '甲', color: '' }, { name: '乙', color: '' }])).toBe(true)
    expect(canCommit([{ name: '甲', color: '' }, { name: '甲', color: '' }])).toBe(false)
  })

  /**
   * 空名 / 禁用字符 / 纯数字这些同样不合法，但写回不丢任何东西（只是那个角色不生效），
   * 而它们往往是作者手写 JSON 时留下的。若因它们锁死整表，作者就再也改不动这个文件。
   */
  it('其余不合法的名字照常写回（否则坏文件永远修不好）', () => {
    expect(canCommit([{ name: '', color: '' }])).toBe(true)
    expect(canCommit([{ name: 'a:b', color: '' }])).toBe(true)
    expect(canCommit([{ name: '7', color: '' }])).toBe(true)
    expect(canCommit([{ name: 'b', color: '' }])).toBe(true)
  })
})
