import { useEffect } from 'react'
import { tokenizeLine } from '../syntax/kin'
import bannerUrl from '../assets/banner.png'

export type HelpScreen = 'about' | 'syntax' | 'theme'

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
  { cat: '流程', id: 'dyndivert', gl: '->{}', zh: '动态跳转', en: 'Dynamic Divert',
    desc: '<code>-> {表达式}</code>：跳转目标由表达式在运行时算出，所有跳转位置都能用。目标写法有两种 —— <b>节点引用</b>：内置表 <code>$nodes</code> 取节点（<code>$nodes.名字</code>，子节点 <code>$nodes.父.子</code>；名字写错当场报错）；<b>字符串</b>：直接写节点名（<code>"大厅"</code> / <code>"父.子"</code> / <code>"END"</code>）。带参节点要先绑实参：<code>$nodes.名(实参)</code>。<code>"名字" in $nodes</code> 判断节点是否存在。',
    code: '~ let back = $nodes.码头       // 把节点存进变量\n-> {back}                     // 跳到变量里的节点\n\n~ let map = { 北: $nodes.走廊 }  // 节点可放进对象 / 数组\n* [往北走] -> {map.北}          // 选项也能动态跳\n\n~ let quest = $nodes.商店("灯笼", 0.8) // 带参节点：先绑实参\n-> {quest}\n\n~ let t = "大厅"               // 字符串：按节点名跳\n-> {t}\n\n@if {"密室" in $nodes}         // 判断节点是否存在\n> -> {"密室"}' },
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
  { cat: '文本', id: 'richtext', gl: '<b>', zh: '内联富文本', en: 'Rich Text',
    desc: '文本行内可加样式的标签，明确闭合、可嵌套（叙述与选项文本同样适用）：<code>&lt;b&gt;</code> 粗、<code>&lt;i&gt;</code> 斜、<code>&lt;u&gt;</code> 下划线、<code>&lt;s&gt;</code> 删除线、<code>&lt;br&gt;</code> 换行（自闭合）。<code>&lt;color=值&gt;</code> 取 <code>#rgb</code> / <code>#rrggbb</code> / CSS 具名色，<code>&lt;size=倍数&gt;</code> 取正数倍数（相对正文字号，渲染为 <code>em</code>）；<b>不接受任意 CSS</b>。<code>&lt;font=名&gt;</code> 换字体（项目内字体文件自动注册，族名 = 文件名去扩展名；系统字体名直接可用），<code>&lt;class=名&gt;</code> 挂语义类名交给作品 css（渲染为 <code>.kin-名</code>，嵌套累积；覆盖整行时样式落在整段上）——两者详见「作品主题」页。仅当 <code>&lt;</code> 后构成合法标签才识别，否则按字面输出（强制字面用 <code>\\&lt;</code>）。未闭合 / 错配 / 非法取值在校验期报 error，运行期优雅降级。',
    code: '她说：<b>别回头</b>，然后<color=#c00>消失在<i>雾</i>里</color>。\n这个词<size=1.5>很大</size>。\n信纸上写着：<font=楷体>见字如晤。</font>\n<class=whisper>他凑到你耳边，说了三个字。</class>\n第一行<br>第二行' },
  { cat: '文本', id: 'pause', gl: '<p>', zh: '句中停顿（点击 / 定时）', en: 'Mid-line Pause',
    desc: '在句中标一个停顿点，两档：<code>&lt;pause&gt;</code>（<b>点击档</b>，自闭合无值）前半句显示后打字停住、推进提示三角亮起，读者点击才续显后半句；<code>&lt;pause=毫秒&gt;</code>（<b>毫秒档</b>）停满时长<b>自动</b>续显，三角不亮、等待期间点击完全无效（既不提前续段也不整行立显，与 <code>@sleep</code> 同立场）。取值须<b>正整数</b>毫秒、上限 <code>2147483647</code>（约 24.8 天），<code>0</code> / 负数 / 小数 / 非数字 / 空值 / 超上限报 error——悬念的节奏由你钦定。两档都是<b>纯呈现层</b>的分段揭示：整行仍是一条记录，不是暂停点，不影响存档；重放（编辑重算）整行直显、零等待，读档后已定型的历史行同样直显（读者当前正在看的那一行照常揭示，其中的停顿会重新生效）。行内任意位置、可多个，可位于 <code>&lt;b&gt;</code> 等样式范围内；行首标记 = 先等满再出文字，连续标记合并为一次、<b>档位取最后一个</b>（<code>&lt;pause&gt;&lt;pause=500&gt;</code> 是 500 毫秒档），行尾标记忽略。停顿<b>不可被跳过穿透</b>：点击档在打字中点击只让当前段立显、仍停在标记处，再点一次才续下一段；<code>flow</code> 模式的自动续行也只发生在整行揭示完之后。自闭合写法 <code>&lt;pause/&gt;</code> / <code>&lt;pause=500/&gt;</code> 等价，强制字面用 <code>\\&lt;pause&gt;</code>。<b>行末</b>的停顿属于行与行之间的演出编排，用 <code>@sleep</code>（见「正文推进节奏」）。',
    code: '凶手就是…<pause>你自己！\n\n门开了一条缝<pause=2000>，什么都没有。\n\n他缓缓抬起头。<pause>那张脸，<pause=800>你认得。' },
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
  { cat: '宿主', id: 'img', gl: '@🖼', zh: '正文插图', en: 'Illustration',
    desc: '<code>@img(路径 [, 替代文字] [, 类名])</code> 在正文流里插一张图——插画、分隔图、场景小图。插图是<b>正文流里的一条内容</b>：随正文滚动、留在阅读历史里、<code>"line"</code> 模式下独占一次点击、<code>@clear()</code> 时随正文一并清除。与全屏背景层 <code>@bg_show</code> 是两回事——一条在流里往下走，一张在底下不动。<b>路径</b>用项目根相对路径（与 <code>@bg_show</code> 同规则）；<b>替代文字</b>是图片的 alt，省略则按装饰性图片处理，加载失败时浏览器显示它；<b>类名</b>是交给作品 css 的样式钩子，规则同 <code>&lt;class=名&gt;</code>，渲染时加 <code>kin-</code> 前缀。三个参数都可用变量。<b>尺寸 / 边框 / 间距归作品主题</b>：每张插图恒带基线类名 <code>.kin-illustration</code>，播放层只保证「不溢出阅读列、块级居中」这条底线，其余在你的 <code>.css</code> 里写（见「作品主题」页）。没有 <code>@img_hide</code>——插图是流里的内容，要清屏用 <code>@clear()</code>。',
    code: '她推开门。\n@img("assets/tavern.jpg", "昏暗的酒馆内景")\n炉火还没灭。\n\n@img("assets/divider.png")            // 装饰性分隔图，无需替代文字\n@img("assets/map.jpg", "王国地图", "wide")  // 交给 .kin-wide 放大排版' },
  { cat: '宿主', id: 'pacing', gl: '@⏱', zh: '正文推进节奏', en: 'Pacing',
    desc: '<code>@clear()</code> 清除已显示正文（背景 / BGM 不受影响）。<code>@step_mode(mode)</code> 切换正文推进方式：<code>"line"</code> 逐段点击才出下一行（打字中点击立即整段显示，等待点击时正文下方有推进提示三角），<code>"flow"</code> 恢复默认连续流动。<code>@text_speed(cps)</code> 调打字机出字速度（字/秒，默认 <code>80</code>，<code>0</code>=整行瞬显）；<code>@text_fade(ms)</code> 调每字淡入时长（毫秒，默认 <code>300</code>，<code>0</code>=无淡入）。三者都是有状态设定，持续生效到下次改写或故事重开；读者开启「减弱动态效果」时整行瞬显，覆盖以上设定。<code>@sleep(ms)</code> 在<b>行与行、命令与命令之间</b>插入定时停顿，用于演出编排（场景切换、音画之间的空拍），<b>不可跳过</b>（读者点击无效）——停顿位置就是它在脚本里的位置，选项 / 输入框前的停顿等满后它们才浮现；读档与重放零等待（预览里编辑重算同样瞬时，只有人工交互才真等）。它是命令、也是硬边界：之前的文字先成行、之后的文字另起一行，<code>&lt;&gt;</code> 粘连也跨不过去，<b>做不到句中停顿</b>——句中停住、后半句续显在同一行请用 <code>&lt;pause&gt;</code> / <code>&lt;pause=毫秒&gt;</code>（见「句中停顿」），后者正是 <code>@sleep</code> 的句中对应物。',
    code: '@step_mode("line")     // 像视觉小说一样点一下出一段\n@text_speed(20)        // 出字放慢营造凝重感（默认 80 字/秒）\n@text_fade(600)        // 淡入更绵长（默认 300ms）\n@clear()               // 清屏，背景与 BGM 不受影响\n\n门，缓缓开了。\n@sleep(1500)           // 行间停顿 1.5 秒，读者点击也跳不过\n里面什么都没有。\n\n@bg_show("assets/night.jpg")\n@sleep(800)            // 场景切换之间的空拍\n@bgm_play("assets/theme.mp3")' },
  { cat: '宿主', id: 'panel', gl: '@▤', zh: '固定区域', en: 'Panel',
    desc: '<code>@panel(槽位, 模板)</code> 给阅读页添加独立于正文流的固定区域，适合 RPG 状态栏、章节指示等。槽位四选一：<code>"left"</code> / <code>"right"</code>（左 / 右侧边栏，宽屏贴对应一侧 / 窄屏折叠为横条）、<code>"bottom"</code>（底部固定条）、<code>"after"</code>（正文后固定栏，随正文滚动、在选项前），<b>须字符串字面量</b>。模板是字符串，支持 <code>{表达式}</code> 插值与全部富文本标签；<b>登记时不求值</b>，引擎在每次推进 / 暂停点重估，结果变了才刷新——<b>改一处变量，区域随下一步自动更新</b>（故模板须纯读取，副作用会反复执行）。再次对同一槽 <code>@panel</code> = 整体替换；空模板 <code>""</code> 清空并隐藏该槽。面板是显示 buffer，无打字机揭示、无交互元素；<b>默认无装饰</b>（文字如正文、无背景无边框），要加外观就覆盖作品 css 的 <code>--kiny-panel-bg/-text/-border</code> 变量或以 <code>.panel-left/.panel-right/.panel-bottom/.panel-after</code> 为选择器自定义。',
    code: '~ let hp = 20\n~ let gold = 5\n@panel("left", "<b>状态</b><br>HP: {hp}<br>金币: {gold}")\n@panel("bottom", "第 {chapter} 章")\n\n~ hp -= 5   // 左栏 HP 下一步自动变 15\n\n@panel("left", "")   // 空模板 = 清空该槽' },
  { cat: '宿主', id: 'input', gl: '@⌨', zh: '读者输入', en: 'Input',
    desc: '<code>@input(变量, 提示?)</code> 是唯一的<b>交互命令</b>——暂停故事、请读者输入一段文本，写回变量供后续插值 <code>{变量}</code> 或 <code>@if</code> 条件使用。第一个参数是<b>变量名本身</b>（写入目标，须先声明），第二个提示可省、作输入框 placeholder。读者留空提交则保留变量原值（充当默认）。',
    code: '~ let player_name = "旅人"\n@input(player_name, "请输入你的名字")\n你好，{player_name}。   // 读者填「阿光」→「你好，阿光。」；留空→「你好，旅人。」' },
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

/** 作品主题 token 契约（与 player `styles.css` 的 `:root` 一一对应）。 */
const THEME_TOKENS: { name: string; use: string }[] = [
  { name: '--kiny-page-bg', use: '页面底色' },
  { name: '--kiny-text', use: '正文文字色' },
  { name: '--kiny-prose-font', use: '正文字体族（改这一行即换全文默认字体）' },
  { name: '--kiny-prose-size', use: '正文字号' },
  { name: '--kiny-prose-line-height', use: '正文行高' },
  { name: '--kiny-content-max-width', use: '阅读栏宽（默认 680px）' },
  { name: '--kiny-bg-overlay', use: '氛围底图上的压暗遮罩色' },
  { name: '--kiny-control-bg', use: '选项按钮 / 输入框底色' },
  { name: '--kiny-control-bg-hover', use: '选项按钮悬停底色' },
  { name: '--kiny-control-text', use: '选项按钮 / 输入框文字色' },
  { name: '--kiny-control-border', use: '选项按钮 / 输入框描边' },
  { name: '--kiny-accent', use: '推进提示三角等强调色' },
  { name: '--kiny-error', use: '运行期错误文字色' },
  { name: '--kiny-panel-bg / -text / -border', use: '固定区域（@panel）的底色 / 文字 / 描边（默认无装饰，覆盖即现）' },
]

/** 作者可依赖的稳定 DOM class（播放层结构锚点）。 */
const THEME_CLASSES: { name: string; use: string }[] = [
  { name: '.player', use: '播放层根（自定义选择器建议都以它为根，避免越界影响编辑器界面）' },
  { name: '.player-content', use: '居中阅读栏容器' },
  { name: '.story-log', use: '叙事流容器' },
  { name: '.narration', use: '一行正文（整行 <class=…> 的类名挂在这里）' },
  { name: '.choices / .choice', use: '选项列表 / 单个选项按钮' },
  { name: '.input-box / .input-box-field / .input-box-submit', use: '@input 输入框区 / 输入框 / 提交按钮' },
  { name: '.bg-layer', use: '氛围底图层' },
  { name: '.advance-indicator', use: 'line 模式等待点击的推进提示' },
  { name: '.panel-left / .panel-right / .panel-bottom / .panel-after', use: '固定区域（@panel）四槽容器' },
]

const THEME_SNIPPET = `/* 项目内任意位置放 .css 即自动加载（按路径字典序；用 10- / 20- 前缀控序）。
   停用某个文件：改扩展名，如 skin.css.bak */

/* ① 换 token —— 最省事的换肤方式 */
:root {
  --kiny-page-bg: #f7f3e9;
  --kiny-text: #2b2622;
  --kiny-prose-font: "楷体";      /* 项目里放 楷体.woff2 即自动注册 */
  --kiny-prose-size: 1.1rem;
  --kiny-content-max-width: 720px;
  --kiny-control-bg: rgba(0,0,0,.05);
  --kiny-control-text: #2b2622;
  --kiny-control-border: rgba(0,0,0,.25);
}

/* ② 深改选择器 —— 一律以 .player 为根 */
.player .choice { border-radius: 2px; letter-spacing: .05em; }

/* ③ 语义类 —— 对应正文里的 <class=名> */
.kin-whisper { opacity: .6; font-style: italic; }
.kin-letter  { background: rgba(0,0,0,.05); padding: 12px; border-radius: 6px; }`

function ThemeScreen() {
  return (
    <div className="help-syntax">
      <div className="help-syn-head">
        <div className="help-syn-title"><b>作品主题</b> —— css 与字体</div>
        <span className="help-syn-ver">项目前端资源</span>
      </div>
      <div className="help-syn-body">
        <div className="help-syn-content">
          <div className="help-syn-cat">资源</div>
          <div className="help-syn-sec">
            <div className="help-syn-sec-h"><h3>放进项目即生效</h3><span className="en">Zero config</span></div>
            <p className="help-syn-desc">
              项目内<b>任何位置</b>的 <code>.css</code> 都会自动加载（按路径字典序注入，用 <code>10-</code> / <code>20-</code> 文件名前缀控制先后）；
              字体文件（<code>.woff2</code> / <code>.woff</code> / <code>.ttf</code> / <code>.otf</code>）自动注册，
              <b>族名 = 文件名去扩展名</b>（<code>楷体.woff2</code> → 族名「楷体」）。不想让某个 css 生效就改扩展名（如 <code>skin.css.bak</code>）。
              这些资源随 <code>.kip</code> 打包、随导出网页内联，在编辑器预览 / 阅读器 / 书库 / 导出网页里表现一致。
              js 本期<b>只可存放与编辑，不自动执行</b>。
            </p>
          </div>
          <div className="help-syn-sec">
            <div className="help-syn-sec-h"><h3>行内字体与语义类</h3><span className="en">font / class</span></div>
            <p className="help-syn-desc">
              <code>&lt;font=名&gt;</code> 在句中切字体（族名未注册时自动回退正文字体）；
              <code>&lt;class=名&gt;</code> 给这段文字挂语义类名，渲染时加 <code>kin-</code> 前缀，外观全由 css 定义。
              类名<b>覆盖整行</b>时挂到行容器 <code>.narration</code> 上（背景 / 边框 / 内边距等块级样式完整可用），只包片段时挂在该片段上。
            </p>
            <KinCode src={'信纸上写着：<font=楷体>见字如晤。</font>\n<class=whisper>他凑到你耳边，说了三个字。</class>\n<class=letter>见字如晤。展信之时，我已在千里之外。</class>'} />
          </div>

          <div className="help-syn-cat">契约</div>
          <div className="help-syn-sec">
            <div className="help-syn-sec-h"><h3>CSS 变量</h3><span className="en">Tokens</span></div>
            <p className="help-syn-desc">覆盖这些变量即换肤，无需改写任何选择器。</p>
            <table className="help-theme-table">
              <tbody>
                {THEME_TOKENS.map((t) => (
                  <tr key={t.name}><td><code>{t.name}</code></td><td>{t.use}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="help-syn-sec">
            <div className="help-syn-sec-h"><h3>稳定 class 名</h3><span className="en">Selectors</span></div>
            <p className="help-syn-desc">播放层的结构锚点，可长期依赖。</p>
            <table className="help-theme-table">
              <tbody>
                {THEME_CLASSES.map((t) => (
                  <tr key={t.name}><td><code>{t.name}</code></td><td>{t.use}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="help-syn-cat">上手</div>
          <div className="help-syn-sec">
            <div className="help-syn-sec-h"><h3>可抄的换肤片段</h3><span className="en">Starter</span></div>
            <p className="help-syn-desc">新建一个 <code>theme.css</code>，粘贴下面内容按需改。</p>
            <pre className="help-kin">{THEME_SNIPPET}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

const SCREEN_LABEL: Record<HelpScreen, string> = {
  about: '关于 Kiny Editor',
  syntax: 'Kiny 语法参考',
  theme: '作品主题参考',
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
        aria-label={SCREEN_LABEL[screen]}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="help-dlg-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        {screen === 'about' ? <AboutScreen /> : screen === 'theme' ? <ThemeScreen /> : <SyntaxScreen />}
      </div>
    </div>
  )
}
