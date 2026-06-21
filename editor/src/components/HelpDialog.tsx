import { useEffect } from 'react'
import { tokenizeLine } from '../syntax/kin'
import bannerUrl from '../assets/banner.png'

export type HelpScreen = 'about' | 'syntax'

export interface HelpDialogProps {
  screen: HelpScreen | null
  onClose: () => void
}

/* 版本号由 vite define 注入（__KINY_VERSION__ = editor/package.json version）。
   统一全局版本后 editor/engine/player 同号，故三者读同一常量。 */
const VERSIONS = { editor: __KINY_VERSION__, engine: __KINY_VERSION__, player: __KINY_VERSION__, license: 'Apache-2.0' }

/** 把多行 .kin 源码渲染成与编辑器语义着色一致的 token 序列。 */
function KinCode({ src }: { src: string }) {
  const lines = src.split('\n')
  return (
    <pre className="help-kin">
      {lines.map((line, i) => (
        <span key={i}>
          {line.length === 0
            ? null
            : tokenizeLine(line).map((tk, j) => (
                <span key={j} className={tk.cls}>
                  {tk.text}
                </span>
              ))}
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </pre>
  )
}

interface Section {
  cat: string
  id: string
  gl: string
  zh: string
  en: string
  /** 允许少量行内标记（<code>/<b>），静态作者内容，安全。 */
  desc: string
  code: string
}

const SECTIONS: Section[] = [
  // ---------- 结构 ----------
  { cat: '结构', id: 'project', gl: '/', zh: '项目结构', en: 'Project',
    desc: '项目根放 <code>kiny.json</code>（<code>name</code> / <code>version</code> / <code>engine</code> / <code>entry</code> 四个必需字段）。引擎自动递归扫描根下所有 <code>.kin</code>，无需 <code>INCLUDE</code>；所有文件共享同一全局节点命名空间。入口文件里第一个节点之前的整段是全局「开场」，故事从这里开始播放。',
    code: 'my-story/\n  kiny.json        // 项目元数据（必需）\n  main.kin         // 入口文件（entry 指向它）\n  chapters/        // 分目录纯属作者偏好\n    city.kin\n  assets/          // 图 / 音（可选）' },
  { cat: '结构', id: 'knot', gl: '===', zh: '节点', en: 'Knot',
    desc: '故事的最小跳转单位。声明用对称三等号 <code>=== 名字 ===</code>（左右各 3 个，不接受 2 或 4 个）。名字可中文、不含空格，<b>全局唯一</b>。执行到底部无跳转会告警 —— 没有隐式 fall-through。',
    code: '=== 雾港开场 ===\n雾从港口涌上来，遮住了路灯。\n你站在码头边。\n-> 出发前\n\n=== 客栈 ===\n你推开了客栈的门，暖气扑面而来。\n-> END' },
  { cat: '结构', id: 'stitch', gl: '=', zh: '子节点', en: 'Stitch',
    desc: '节点内用单个 <code>=</code>（无右侧等号）切分子节点。子节点名只在父节点内唯一。<b>无默认入口、无 fall-through</b>：进入父节点只执行其正文，遇第一个 <code>=</code> 即结束。同父内 <code>-> 子节点</code>，跨父用 <code>父.子</code>。',
    code: '=== 火车上 ===\n雾从车窗外掠过。\n-> 头等舱\n\n= 头等舱\n奢华的场景……\n-> END\n\n= 三等舱\n拥挤的场景……\n-> END' },
  { cat: '结构', id: 'params', gl: '( )', zh: '带参节点', en: 'Parameters',
    desc: '节点名后可带参数列表，参数即该节点的局部变量（进入时绑定、离开时销毁）。<b>参数名必须英文</b>（同变量规则）。带参节点只能经 <code>-> 名字(实参)</code> 进入，实参个数须匹配。',
    code: '=== 商店(category, discount) ===\n@if {discount > 0}\n> 老板朝你笑，「今天的{category}打折！」\n@else\n> 「看看{category}吧。」\n* [买下] -> 结账\n* [离开] -> 街道' },

  // ---------- 流程 ----------
  { cat: '流程', id: 'divert', gl: '->', zh: '跳转', en: 'Divert',
    desc: '<code>-> 目标</code> 立即跳到另一节点，可独立成行或贴在文本末尾（控制流等价）。跳转后本节点剩余内容不再执行。<code>-> END</code> 结束故事，<code>-> DONE</code> 结束当前线程（暂等同 END）。',
    code: '你走出了房间。\n-> 走廊\n\n你走出了房间。-> 走廊\n\n-> 商店("灯笼", 0.8)   // 带参跳转\n-> END' },
  { cat: '流程', id: 'choice', gl: '*', zh: '选项', en: 'Choice',
    desc: '<code>*</code> 一次性（选过即消失）/ <code>+</code> 粘性（可重复）。<code>[文本]</code> 内只在列表显示、<code>]</code> 之后只在点击后正文显示；省略 <code>[]</code> 则两处同文。<code>{条件}</code> 紧跟 <code>*</code> 之后，假则不显示。',
    code: '* [走向客栈] -> inn\n+ [再看一眼码头] -> docks\n* [我累了。] 「辛苦你了，」他回答。 -> 休息\n* {gold >= 5} [买下灯笼] -> buy_lantern' },
  { cat: '流程', id: 'choice2', gl: '( )', zh: '标签与后备', en: 'Label & Fallback',
    desc: '<code>(label)</code> 写在 <code>*</code> 之后，引擎自动追踪该选项被选次数，等价一个全局计数变量，用 <code>{label}</code> 读取（标签名须英文、全局唯一）。<b>后备选项</b> <code>* -> 目标</code>（无文本、无条件）在其他选项都不可用时触发，每组至多一个。',
    code: '* (greet) [问候他] 「你好。」\n* (ignore) [无视他] 我什么也没说。\n\n* {greet} [问他叫什么] -> 问名字\n* {!tried_b} [尝试 B] -> 试B\n* -> 没招了' },
  { cat: '流程', id: 'branch', gl: '>', zh: '分支体与汇合', en: 'Branching',
    desc: '选项选中后执行的分支体用行首 <code>></code> 标层级，<code>></code> 个数 = 嵌套深度。层级减少 = 内层分支汇合到外层；回到 0 = 整组结束、全部汇合。<b>建议嵌套不超过 3 层。</b>选项若直接 <code>-> 目标</code> 或在体内显式跳走，则不参与汇合。',
    code: '* [吃米饭]\n> 你点了米饭。\n> * [青菜]\n> > 你点了青菜。\n> * [肉]\n> > 你点了肉。\n> 服务员记下了。\n* [吃面]\n> 你点了面。\n\n「好嘞，」服务员说。' },
  { cat: '流程', id: 'cond', gl: '@if', zh: '条件控制', en: 'Conditional',
    desc: '跨行条件块用 <code>@if</code> / <code>@elif</code> / <code>@else</code>，条件写在 <code>{ }</code>。分支体与选项共用同一套 <code>></code> 层级，可任意互嵌。<b>无结束符</b>：某行回到选择器层级且非 <code>@elif</code>/<code>@else</code> 时整链闭合。体内执行 JS 用 <code>> ~</code>。',
    code: '@if {gold >= 5}\n> ~ gold -= 5\n> 你接过酒杯，喝了一口。\n@elif {met < 3}\n> 你们算是脸熟了。\n@else\n> 钱不够，你摇了摇头。' },

  // ---------- 逻辑（JavaScript） ----------
  { cat: '逻辑', id: 'vars', gl: '~', zh: '变量与作用域', en: 'Variables',
    desc: 'Kiny 的逻辑<b>就是 JavaScript</b>。<code>~</code> 起首执行一条 JS 语句（声明 / 赋值 / 调用）。用 <code>let</code> / <code>const</code> 声明，变量名须 ASCII。文件顶部（任何节点前）的声明是<b>全局</b>作用域；节点内声明随离开节点销毁（含其子节点）。拼错变量名立即报错。',
    code: '~ let gold = 10\n~ let player = { name: "无名氏", hp: 100 }\n~ const MAX_HP = 100\n~ gold -= 5\n~ player.hp -= 10\n~ inventory.push("药水")' },
  { cat: '逻辑', id: 'block', gl: '~~~', zh: '多行 JS 块', en: 'Logic Block',
    desc: '多语句 / 循环 / 函数定义用 <code>~~~ … ~~~</code>（起止各占一行）。块内是任意 JS，<b>不能嵌 Kiny 语法</b>（跳转 / 选项 / 插值），不产出文本。只能写在节点正文顶层，不能进选项体或 <code>@if</code> 分支体。',
    code: '~~~\nlet total = 0\nfor (const item of inventory) {\n  total += item.price\n}\ngold = total\n~~~' },
  { cat: '逻辑', id: 'interp', gl: '{ }', zh: '表达式插值', en: 'Interpolation',
    desc: '文本中 <code>{ JS 表达式 }</code> 求值后插入。<code>{ }</code> 在 Kiny 中只有这一种含义 —— 求值一段 JS 表达式、输出其字符串。行内条件就用三元。<code>undefined</code> / <code>null</code> 输出空串；引用未声明变量在编译期报错。',
    code: '你还剩 {gold} 枚金币。\n你的攻击力是 {strength * 2}。\n你的状态：{ hp > 50 ? "良好" : "虚弱" }。\n你的灯笼{ has_lantern ? "亮着" : "熄灭" }。' },
  { cat: '逻辑', id: 'func', gl: 'fn', zh: '函数', en: 'Function',
    desc: 'Kiny 不发明函数语法 —— 用 JS 的 <code>function</code> 或箭头函数，写在 <code>~~~</code> 块里。取文本用 <code>{ f(x) }</code>，纯副作用用 <code>~ f(x)</code>。函数跨文件共享同一全局作用域，函数名与变量名全局唯一。',
    code: '~~~\nfunction describe_health(x) {\n  if (x === 100) return "健康"\n  if (x > 75) return "不错"\n  return "虚弱"\n}\n~~~\n\nFogg 看起来{ describe_health(hp) }。' },
  { cat: '逻辑', id: 'builtins', gl: '()', zh: '内置函数', en: 'Builtins',
    desc: '纯数学 / 类型转换直接用 JS（<code>Math.floor</code>、<code>parseFloat</code> 等）。内置函数只保留引擎能力，且为<b>保留标识符</b>，不可用作变量名 / 参数名 / 选项标签。',
    code: '~ let dice = random(1, 6)      // [min,max] 闭区间随机整数\n~ seed_random(42)             // 设随机种子（可复现）\n{ turns() } 回合过去了。\n{ turns_since("码头开场") } 回合前到的码头。' },

  // ---------- 文本 ----------
  { cat: '文本', id: 'text', gl: 'T', zh: '段落与换行', en: 'Text',
    desc: '节点正文里所有<b>非控制行</b>都是普通文本，每行 = 一段输出、行末自动换行。<b>空行被忽略</b>（可自由插入提升可读性）。行首行末空白被裁掉，普通文本里的缩进<b>没有语义</b>。引号与中英文标点都是普通字符。',
    code: '雾从港口涌上来，遮住了路灯。\n你站在码头边。\n\n你听见远处传来汽笛声。\n「想要点什么？」老板问。' },
  { cat: '文本', id: 'alt', gl: 'seq', zh: '文本变体', en: 'Alternatives',
    desc: '「活文本」—— 同一处文字随访问次数变化，由四个内置函数实现，按<b>源码位置</b>自动计数：<code>seq</code> 依次推进、停在最后；<code>cycle</code> 循环；<code>once</code> 用完返回空串；<code>shuffle</code> 随机（受 <code>seed_random</code> 控制）。',
    code: '钟声{ seq("响了", "又响了", "这回很远了") }。\n今天是{ cycle("周一","周二","周三","周日") }。\n他笑了。{ once("这是我第一次见他笑。") }\n风吹过。{ shuffle("你打了个寒颤。", "你拉紧了衣领。") }' },
  { cat: '文本', id: 'glue', gl: '<>', zh: '粘连', en: 'Glue',
    desc: '默认每段文本后换行。<code>&lt;&gt;</code> 紧贴文本<b>末尾</b>，取消其后的换行让下一段贴上来 —— 即便中间隔着一次 <code>-></code> 跳转。<code>-></code> 不产出文本，<code>&lt;&gt;</code> 永远贴在文本一侧，没有行首 <code>&lt;&gt;</code>。',
    code: '我转身离开<>\n-> next_room\n\n=== next_room ===\n，头也不回。\n\n我转身离开<> -> next_room   // 内联等价写法' },
  { cat: '文本', id: 'escape', gl: '\\', zh: '转义', en: 'Escape',
    desc: '用反斜杠 <code>\\</code> 输出特殊符号的字面形态。<b>任意位置需转义</b>：<code>\\{ \\} \\&lt; \\/ \\\\</code>。<b>仅作行首字符时需转义</b>：<code>\\= \\* \\+ \\&gt; \\~ \\@ \\-&gt;</code>。<b>仅选项行内</b>：<code>\\[ \\] \\( \\)</code>。',
    code: '价格区间 \\{100, 200\\} 元。\n访问 http:\\//example.com 看看。\n\\* 这一行以字面星号开头。\n选项里要显示方括号：\\[注\\]。' },
  { cat: '文本', id: 'comment', gl: '//', zh: '注释', en: 'Comment',
    desc: '<code>//</code> 单行注释（也可写在行末），<code>/* … */</code> 多行注释。',
    code: '// 雾港之夜 —— main.kin\n~ let imposter = random(0, 1)   // 1=冒充者，0=真灰隼\n/*\n  四结局 = 身份 × 你的决断\n*/' },

  // ---------- 宿主 ----------
  { cat: '宿主', id: 'cmd', gl: '@', zh: '内置命令', en: 'Command',
    desc: '<code>@命令(参数)</code> 独占一行、行首顶格，向宿主（编辑器 / 阅读器）下达副作用指令，<b>不产出叙事文本</b>。参数是 JS 表达式（可动态），资源用项目根相对路径。引擎只认内置命令集，未知命令报错。',
    code: '@bg_show("assets/tavern_interior.jpg")  // 显示背景图\n@bg_hide()                              // 隐藏背景图\n@bgm_play("assets/tavern_loop.mp3")     // 播放背景音乐\n@bgm_pause()  @bgm_stop()               // 暂停 / 停止' },
]

function AboutScreen() {
  return (
    <div className="help-about">
      <div className="help-about-hero">
        <img className="help-about-banner" src={bannerUrl} alt="Kiny — Interactive Fiction Engine" />
        <div className="help-about-sub">互动叙事编辑器</div>
      </div>
      <div className="help-about-meta">
        <div className="help-meta-cell"><div className="help-meta-k">编辑器</div><div className="help-meta-v">{VERSIONS.editor}</div></div>
        <div className="help-meta-cell"><div className="help-meta-k">引擎</div><div className="help-meta-v">{VERSIONS.engine}</div></div>
        <div className="help-meta-cell"><div className="help-meta-k">播放层</div><div className="help-meta-v">{VERSIONS.player}</div></div>
        <div className="help-meta-cell"><div className="help-meta-k">协议</div><div className="help-meta-v">{VERSIONS.license}</div></div>
      </div>
      <div className="help-about-foot">© 2026 firzencode　·　内嵌字体 JetBrains Mono（SIL OFL 1.1）</div>
    </div>
  )
}

function SyntaxScreen() {
  const scrollTo = (id: string) => {
    document.getElementById(`help-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  let navCat: string | null = null
  let bandCat: string | null = null
  return (
    <div className="help-syntax">
      <div className="help-syn-head">
        <div className="help-syn-title">
          <b>Kiny</b> 语法参考
        </div>
        <span className="help-syn-ver">DSL v0.1.0</span>
      </div>
      <div className="help-syn-body">
        <nav className="help-syn-nav">
          {SECTIONS.map((s) => {
            const head = s.cat !== navCat ? <div className="help-syn-nav-cat" key={`c-${s.cat}`}>{s.cat}</div> : null
            navCat = s.cat
            return (
              <span key={s.id}>
                {head}
                <a onClick={() => scrollTo(s.id)}>
                  <span className="gl">{s.gl}</span>
                  {s.zh}
                </a>
              </span>
            )
          })}
        </nav>
        <div className="help-syn-content">
          {SECTIONS.map((s) => {
            const band = s.cat !== bandCat ? <div className="help-syn-cat" key={`b-${s.cat}`}>{s.cat}</div> : null
            bandCat = s.cat
            return (
              <span key={s.id}>
                {band}
                <div className="help-syn-sec" id={`help-sec-${s.id}`}>
                  <div className="help-syn-sec-h">
                    <h3>{s.zh}</h3>
                    <span className="en">{s.en}</span>
                  </div>
                  <p className="help-syn-desc" dangerouslySetInnerHTML={{ __html: s.desc }} />
                  <KinCode src={s.code} />
                </div>
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function HelpDialog({ screen, onClose }: HelpDialogProps) {
  useEffect(() => {
    if (!screen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, onClose])

  if (!screen) return null
  return (
    <div className="help-scrim" onClick={onClose}>
      <div
        className={'help-dlg help-dlg-' + screen}
        role="dialog"
        aria-modal="true"
        aria-label={screen === 'about' ? '关于 Kiny Editor' : 'Kiny 语法参考'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="help-dlg-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        {screen === 'about' ? <AboutScreen /> : <SyntaxScreen />}
      </div>
    </div>
  )
}
