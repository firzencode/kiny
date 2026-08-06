import { describe, it, expect } from 'vitest'
import { scanInline, splitInlineDivert } from './inline'
import { ParseError } from './errors'

const scan = (t: string, startId = 0) => scanInline(t, startId, 1, 'f.kin')

describe('scanInline —— 字面与插值', () => {
  it('纯字面文本', () => {
    expect(scan('你好世界')).toEqual({
      segments: [{ kind: 'literal', value: '你好世界' }],
      glue: false,
      nextId: 0,
      issues: [],
    })
  })

  it('单个插值分配 id 0', () => {
    expect(scan('你有{gold}金币')).toEqual({
      segments: [
        { kind: 'literal', value: '你有' },
        { kind: 'interp', code: 'gold', id: 0 },
        { kind: 'literal', value: '金币' },
      ],
      glue: false,
      nextId: 1,
      issues: [],
    })
  })

  it('多个插值依次分配 id，从 startId 起', () => {
    expect(scan('{a}{b}', 5)).toEqual({
      segments: [
        { kind: 'interp', code: 'a', id: 5 },
        { kind: 'interp', code: 'b', id: 6 },
      ],
      glue: false,
      nextId: 7,
      issues: [],
    })
  })

  it('插值 code 是 {} 之间的原始 JS（字符串内 } 不闭合）', () => {
    expect(scan('{ "a}b" }')).toEqual({
      segments: [{ kind: 'interp', code: ' "a}b" ', id: 0 }],
      glue: false,
      nextId: 1,
      issues: [],
    })
  })

  it('空字符串无 segment', () => {
    expect(scan('')).toEqual({ segments: [], glue: false, nextId: 0, issues: [] })
  })
})

describe('scanInline —— 转义还原', () => {
  it('\\{ \\} \\< \\/ \\\\ 任意位置还原为字面', () => {
    expect(scan('a\\{b\\}c\\<d\\/e\\\\f').segments).toEqual([
      { kind: 'literal', value: 'a{b}c<d/e\\f' },
    ])
  })

  it('\\-> 还原为字面 ->', () => {
    expect(scan('走\\->吧').segments).toEqual([{ kind: 'literal', value: '走->吧' }])
  })

  it('未定义的转义保留反斜杠', () => {
    expect(scan('a\\b').segments).toEqual([{ kind: 'literal', value: 'a\\b' }])
  })
})

describe('scanInline —— 粘连 <>', () => {
  it('行末 <> 置 glue，不进 segments', () => {
    expect(scan('离开<>')).toEqual({
      segments: [{ kind: 'literal', value: '离开' }],
      glue: true,
      nextId: 0,
      issues: [],
    })
  })

  it('转义的 \\<> 不是粘连', () => {
    expect(scan('a\\<>')).toEqual({
      segments: [{ kind: 'literal', value: 'a<>' }],
      glue: false,
      nextId: 0,
      issues: [],
    })
  })

  it('非行末的 <> 不是粘连，按字面处理', () => {
    expect(scan('a<>b').segments).toEqual([{ kind: 'literal', value: 'a<>b' }])
    expect(scan('a<>b').glue).toBe(false)
  })

  it('行末 <> 之后仅余空白也算 glue', () => {
    expect(scan('离开<> ')).toEqual({
      segments: [{ kind: 'literal', value: '离开' }],
      glue: true,
      nextId: 0,
      issues: [],
    })
  })
})

describe('scanInline —— 富文本标签', () => {
  it('单个 <b> 标签把内部文本标粗，标签外不带样式', () => {
    expect(scan('普通<b>粗体</b>尾').segments).toEqual([
      { kind: 'literal', value: '普通' },
      { kind: 'literal', value: '粗体', style: { bold: true } },
      { kind: 'literal', value: '尾' },
    ])
  })

  it('i / u / s 各映射对应样式键', () => {
    expect(scan('<i>斜</i><u>下</u><s>删</s>').segments).toEqual([
      { kind: 'literal', value: '斜', style: { italic: true } },
      { kind: 'literal', value: '下', style: { underline: true } },
      { kind: 'literal', value: '删', style: { strike: true } },
    ])
  })

  it('嵌套标签扁平化叠加样式', () => {
    expect(scan('<b>粗<color=red>粗红</color></b>').segments).toEqual([
      { kind: 'literal', value: '粗', style: { bold: true } },
      { kind: 'literal', value: '粗红', style: { bold: true, color: 'red' } },
    ])
  })

  it('<color> 支持 #rgb / #rrggbb / 具名色', () => {
    expect(scan('<color=#f00>a</color><color=#ff0000>b</color><color=blue>c</color>').segments).toEqual([
      { kind: 'literal', value: 'a', style: { color: '#f00' } },
      { kind: 'literal', value: 'b', style: { color: '#ff0000' } },
      { kind: 'literal', value: 'c', style: { color: 'blue' } },
    ])
  })

  it('<size> 落正数倍数；内层覆盖外层', () => {
    expect(scan('<size=1.5>大<size=0.8>小</size></size>').segments).toEqual([
      { kind: 'literal', value: '大', style: { size: 1.5 } },
      { kind: 'literal', value: '小', style: { size: 0.8 } },
    ])
  })

  it('<br> 产出换行段（自闭合，无文本）', () => {
    expect(scan('上<br>下').segments).toEqual([
      { kind: 'literal', value: '上' },
      { kind: 'break' },
      { kind: 'literal', value: '下' },
    ])
  })

  it('插值段承继当前标签样式', () => {
    expect(scan('<b>{x}</b>').segments).toEqual([
      { kind: 'interp', code: 'x', id: 0, style: { bold: true } },
    ])
  })

  it('未闭合标签：自动闭合到段末（样式照应用）+ 记 rich-unclosed 诊断', () => {
    const r = scan('<b>粗到底')
    expect(r.segments).toEqual([{ kind: 'literal', value: '粗到底', style: { bold: true } }])
    expect(r.issues).toEqual([{ code: 'rich-unclosed', message: '未闭合的标签：「<b>」', line: 1 }])
  })

  it('错配闭标签：弹到最近同名开标签；孤立闭标签记 rich-mismatch', () => {
    const r = scan('a</i>b')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'ab' }])
    expect(r.issues).toEqual([{ code: 'rich-mismatch', message: '孤立的闭标签：「</i>」', line: 1 }])
  })

  it('非法颜色值：不应用颜色 + 记 rich-bad-color（标签结构仍成对）', () => {
    const r = scan('<color=rgb(1,2,3)>x</color>')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x' }])
    expect(r.issues).toEqual([{ code: 'rich-bad-color', message: '非法颜色值：「rgb(1,2,3)」', line: 1 }])
  })

  it('非法字号值：不应用字号 + 记 rich-bad-size', () => {
    const r = scan('<size=-1>x</size>')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x' }])
    expect(r.issues).toEqual([{ code: 'rich-bad-size', message: '非法字号倍数：「-1」', line: 1 }])
  })

  it('未知标签名按字面处理裸 <（兼容历史文本）', () => {
    expect(scan('a<foo>b').segments).toEqual([{ kind: 'literal', value: 'a<foo>b' }])
    expect(scan('1 < 2 > 0').segments).toEqual([{ kind: 'literal', value: '1 < 2 > 0' }])
  })

  it('\\< 转义后不识别为标签', () => {
    expect(scan('\\<b>x').segments).toEqual([{ kind: 'literal', value: '<b>x' }])
  })
})

describe('scanInline —— <font=名>', () => {
  it('落字体名；内层覆盖外层（与 size 同语义）', () => {
    expect(scan('<font=楷体>信<font=宋体>札</font></font>').segments).toEqual([
      { kind: 'literal', value: '信', style: { font: '楷体' } },
      { kind: 'literal', value: '札', style: { font: '宋体' } },
    ])
  })

  it('名字两侧空白 trim 后落', () => {
    expect(scan('<font= 楷体 >x</font>').segments).toEqual([
      { kind: 'literal', value: 'x', style: { font: '楷体' } },
    ])
  })

  it('允许 Unicode 字母数字与空格、点、下划线、连字符', () => {
    expect(scan('<font=Noto Sans SC>x</font>').segments).toEqual([
      { kind: 'literal', value: 'x', style: { font: 'Noto Sans SC' } },
    ])
  })

  it('非法字体名（含分号 / 括号等注入字符）：不应用 + 记 rich-bad-font', () => {
    const r = scan('<font=a;color:red>x</font>')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x' }])
    expect(r.issues).toEqual([{ code: 'rich-bad-font', message: '非法字体名：「a;color:red」', line: 1 }])
  })

  it('空字体名非法', () => {
    expect(scan('<font=>x</font>').issues).toEqual([
      { code: 'rich-bad-font', message: '非法字体名：「」', line: 1 },
    ])
  })

  it('与其它样式共存', () => {
    expect(scan('<b><font=楷体>x</font></b>').segments).toEqual([
      { kind: 'literal', value: 'x', style: { bold: true, font: '楷体' } },
    ])
  })
})

describe('scanInline —— <class=名>', () => {
  it('落类名数组', () => {
    expect(scan('<class=whisper>低语</class>').segments).toEqual([
      { kind: 'literal', value: '低语', style: { classes: ['whisper'] } },
    ])
  })

  it('嵌套累积（与 font 的内层覆盖不同）', () => {
    expect(scan('<class=letter>信<class=old>旧</class></class>').segments).toEqual([
      { kind: 'literal', value: '信', style: { classes: ['letter'] } },
      { kind: 'literal', value: '旧', style: { classes: ['letter', 'old'] } },
    ])
  })

  it('同名嵌套去重', () => {
    expect(scan('<class=a><class=a>x</class></class>').segments).toEqual([
      { kind: 'literal', value: 'x', style: { classes: ['a'] } },
    ])
  })

  it('允许中文 / 数字 / 下划线 / 连字符', () => {
    expect(scan('<class=旁白_2-b>x</class>').segments).toEqual([
      { kind: 'literal', value: 'x', style: { classes: ['旁白_2-b'] } },
    ])
  })

  it('含空格的类名非法：不应用 + 记 rich-bad-class', () => {
    const r = scan('<class=a b>x</class>')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x' }])
    expect(r.issues).toEqual([{ code: 'rich-bad-class', message: '非法类名：「a b」', line: 1 }])
  })

  it('含点的类名非法（css 选择器边界字符）', () => {
    expect(scan('<class=a.b>x</class>').issues).toEqual([
      { code: 'rich-bad-class', message: '非法类名：「a.b」', line: 1 },
    ])
  })

  it('与 font / 其它样式共存', () => {
    expect(scan('<class=letter><font=楷体>x</font></class>').segments).toEqual([
      { kind: 'literal', value: 'x', style: { font: '楷体', classes: ['letter'] } },
    ])
  })

  it('未闭合记 rich-unclosed（样式照应用到段末）', () => {
    const r = scan('<class=a>x')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x', style: { classes: ['a'] } }])
    expect(r.issues).toEqual([{ code: 'rich-unclosed', message: '未闭合的标签：「<class>」', line: 1 }])
  })

  it('同样式相邻段归并（class 数组相等即同样式）', () => {
    expect(scan('<class=a>甲</class><class=a>乙</class>').segments).toEqual([
      { kind: 'literal', value: '甲乙', style: { classes: ['a'] } },
    ])
  })
})

describe('scanInline —— <pause> 句中停顿标记', () => {
  it('句中标记：后半段带 pauseBefore，强制断开', () => {
    expect(scan('凶手就是…<pause>你自己！').segments).toEqual([
      { kind: 'literal', value: '凶手就是…' },
      { kind: 'literal', value: '你自己！', pauseBefore: true },
    ])
  })

  it('行首标记：第一段即带 pauseBefore（先等一次点击再出文字）', () => {
    expect(scan('<pause>迟来的一句。').segments).toEqual([
      { kind: 'literal', value: '迟来的一句。', pauseBefore: true },
    ])
  })

  it('行尾标记忽略（行尾本就是行边界）', () => {
    expect(scan('说完了。<pause>').segments).toEqual([{ kind: 'literal', value: '说完了。' }])
  })

  it('连续标记合并为一次停顿', () => {
    expect(scan('前<pause><pause>后').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'literal', value: '后', pauseBefore: true },
    ])
  })

  it('同样式跨标记不归并（否则标记位置丢失）', () => {
    expect(scan('<b>前<pause>后</b>').segments).toEqual([
      { kind: 'literal', value: '前', style: { bold: true } },
      { kind: 'literal', value: '后', style: { bold: true }, pauseBefore: true },
    ])
  })

  it('标记可位于样式范围内，不影响样式作用域', () => {
    expect(scan('普通<color=red>红<pause>还红</color>普通').segments).toEqual([
      { kind: 'literal', value: '普通' },
      { kind: 'literal', value: '红', style: { color: 'red' } },
      { kind: 'literal', value: '还红', style: { color: 'red' }, pauseBefore: true },
      { kind: 'literal', value: '普通' },
    ])
  })

  it('插值段也能承载标记', () => {
    expect(scan('前<pause>{x}').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'interp', code: 'x', id: 0, pauseBefore: true },
    ])
  })

  it('<br> 也能承载标记', () => {
    expect(scan('上<pause><br>下').segments).toEqual([
      { kind: 'literal', value: '上' },
      { kind: 'break', pauseBefore: true },
      { kind: 'literal', value: '下' },
    ])
  })

  it('<pause/> 自闭合写法等价（与 <br/> 一致）', () => {
    expect(scan('前<pause/>后').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'literal', value: '后', pauseBefore: true },
    ])
  })

  it('\\<pause> 转义后按字面输出', () => {
    expect(scan('a\\<pause>b').segments).toEqual([{ kind: 'literal', value: 'a<pause>b' }])
  })

})

describe('scanInline —— <pause=毫秒> 定时续显（毫秒档）', () => {
  it('句中毫秒档：后半段 pauseBefore 携毫秒数', () => {
    const r = scan('门开了一条缝<pause=2000>，什么都没有。')
    expect(r.issues).toEqual([])
    expect(r.segments).toEqual([
      { kind: 'literal', value: '门开了一条缝' },
      { kind: 'literal', value: '，什么都没有。', pauseBefore: 2000 },
    ])
  })

  it('<pause=500/> 尾随斜杠等价（与 <pause/> / <br/> 对称）', () => {
    expect(scan('前<pause=500/>后').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'literal', value: '后', pauseBefore: 500 },
    ])
  })

  it.each(['0', '-1', '1.5', 'abc', '', ' 500 ', '1e3', '+5', '2147483648', '9007199254740993'])(
    '非法取值「%s」报 rich-bad-pause、不产生边界',
    (v) => {
      const r = scan(`前<pause=${v}>后`)
      expect(r.issues).toEqual([
        { code: 'rich-bad-pause', message: `非法停顿时长：「${v}」（<pause=毫秒> 只接受正整数毫秒）`, line: 1 },
      ])
      expect(r.segments).toEqual([{ kind: 'literal', value: '前后' }]) // 非法标记不产生边界
    },
  )

  it('上限 2147483647（setTimeout 32 位钳制边界）内合法、超出报错', () => {
    // 超上限若放行，setTimeout 溢出成「立刻触发」= 静默不停顿；宁可校验期报错让作者看见。
    expect(scan('前<pause=2147483647>后').issues).toEqual([])
    expect(scan('前<pause=2147483648>后').issues).toHaveLength(1)
  })

  it('非法标记作废前一个待挂标记（「取最后一个」一致，只不过最后一个是废的）', () => {
    const r = scan('前<pause><pause=abc>后')
    expect(r.issues).toHaveLength(1)
    expect(r.segments).toEqual([{ kind: 'literal', value: '前后' }]) // 不残留点击档边界
  })

  it('报错回显作者原样写的取值（含尾随斜杠）', () => {
    expect(scan('前<pause=abc/>后').issues).toEqual([
      { code: 'rich-bad-pause', message: '非法停顿时长：「abc/」（<pause=毫秒> 只接受正整数毫秒）', line: 1 },
    ])
  })

  it('\\<pause=500> 转义后按字面输出', () => {
    expect(scan('a\\<pause=500>b').segments).toEqual([{ kind: 'literal', value: 'a<pause=500>b' }])
  })

  it('样式范围内携档位', () => {
    expect(scan('<b>前<pause=300>后</b>').segments).toEqual([
      { kind: 'literal', value: '前', style: { bold: true } },
      { kind: 'literal', value: '后', style: { bold: true }, pauseBefore: 300 },
    ])
  })

  it('行首毫秒档允许（先等满时长再出文字）', () => {
    expect(scan('<pause=800>迟来的一句。').segments).toEqual([
      { kind: 'literal', value: '迟来的一句。', pauseBefore: 800 },
    ])
  })

  it('行尾毫秒档忽略（行尾停顿归 @sleep）', () => {
    expect(scan('说完了。<pause=800>').segments).toEqual([{ kind: 'literal', value: '说完了。' }])
  })

  it('相邻标记取最后一个：<pause><pause=500> 是 500 毫秒档', () => {
    expect(scan('前<pause><pause=500>后').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'literal', value: '后', pauseBefore: 500 },
    ])
  })

  it('相邻标记取最后一个：<pause=500><pause> 是点击档', () => {
    expect(scan('前<pause=500><pause>后').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'literal', value: '后', pauseBefore: true },
    ])
  })

  it('空插值不消费标记，档值顺延给下一个非空段', () => {
    expect(scan('前<pause=1200>{x}').segments).toEqual([
      { kind: 'literal', value: '前' },
      { kind: 'interp', code: 'x', id: 0, pauseBefore: 1200 },
    ])
  })

  it('<br> 承接毫秒档', () => {
    expect(scan('上<pause=400><br>下').segments).toEqual([
      { kind: 'literal', value: '上' },
      { kind: 'break', pauseBefore: 400 },
      { kind: 'literal', value: '下' },
    ])
  })
})

describe('scanInline —— 错误', () => {
  it('未闭合的 { 抛 ParseError，带行号与路径', () => {
    try {
      scanInline('你有{gold 金币', 0, 7, 'main.kin')
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(7)
      expect((e as ParseError).path).toBe('main.kin')
    }
  })
})

describe('splitInlineDivert', () => {
  it('无 -> 时 divert 为 null', () => {
    expect(splitInlineDivert('走吧')).toEqual({ text: '走吧', divert: null })
  })

  it('切出行末 -> 跳转', () => {
    expect(splitInlineDivert('走吧 -> 家')).toEqual({ text: '走吧 ', divert: '-> 家' })
  })

  it('转义的 \\-> 不算跳转', () => {
    expect(splitInlineDivert('走吧\\->家')).toEqual({ text: '走吧\\->家', divert: null })
  })

  it('插值内的 -> 不算跳转', () => {
    expect(splitInlineDivert('{a->b}尾')).toEqual({ text: '{a->b}尾', divert: null })
  })

  it('<> 留在左半文本里', () => {
    expect(splitInlineDivert('离开<> -> 家')).toEqual({ text: '离开<> ', divert: '-> 家' })
  })

  it('整行就是跳转时左半为空', () => {
    expect(splitInlineDivert('-> 家')).toEqual({ text: '', divert: '-> 家' })
  })
})
