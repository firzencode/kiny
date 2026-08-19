import { plainText } from '@kiny/engine'
import type { InteractionStep, PlayState } from '@kiny/player'

/**
 * 导出网页 / 在线 demo 的存档层：整份存档列表存 localStorage 单键。
 *
 * 存的是交互序列 `{ seed, seq }` 而非引擎快照——导出网页是单文件、`file://` 下没有
 * IndexedDB 可退，localStorage 的配额是唯一去处；一条序列几百字节，快照含全部滚屏 log
 * 则是数十到数百 KB。读档经 player 的 `replayToStory` 重放，重建出的 PlayState 完整
 * （滚屏 / 背景 / 当前选项都在），故功能上与 reader / shelf 的快照存档等价。
 *
 * 键按作品的稳定 id 分桶（无 id 的老导出回退故事名）、**不编版本号**：版本失配由「能不能重放
 * 成功」判定（见 App 的读档路径），作者改错别字 / 调文案不让读者存档整批蒸发。
 */

/** 自动续读那条存档的固定 id（每份作品唯一一条，持续覆盖）。 */
export const AUTO_SAVE_ID = 'auto'

const PREFIX = 'kiny-saves:'
const LEGACY_PREFIX = 'kiny-progress:'

/** 一条存档：种子 + 交互序列足以经 replayToStory 重建完整播放态。 */
export interface ViewerSave {
  /** 自动存档恒为 AUTO_SAVE_ID；手动存档为 32 位十六进制。 */
  id: string
  kind: 'auto' | 'manual'
  seed: number
  seq: InteractionStep[]
  meta: {
    /** 毫秒时间戳（存档时刻）。 */
    timestamp: number
    /** 预览标签（末条叙事片段），列表展示用。 */
    label: string
  }
}

/**
 * localStorage 键：优先作品稳定 id（manifest 的 `id`），无 id 的老导出退回故事名。
 * `file://` 下全部本地网页共用一份 localStorage，键必须自带作品标识；而故事名会重名、会被作者
 * 改动，只有 id 稳定。键里不拼故事名——名字一改键就漂，等于改名弃档。
 */
export function savesKey(id: string | undefined, title: string): string {
  return `${PREFIX}${id ?? title}`
}

function isStep(s: unknown): s is InteractionStep {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  if (o.kind === 'choice') {
    return typeof o.pos === 'number' && (o.text === undefined || typeof o.text === 'string')
  }
  return o.kind === 'input' && typeof o.text === 'string'
}

function isSave(v: unknown): v is ViewerSave {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || (o.kind !== 'auto' && o.kind !== 'manual')) return false
  if (typeof o.seed !== 'number' || !Array.isArray(o.seq) || !o.seq.every(isStep)) return false
  const m = o.meta as Record<string, unknown> | undefined
  return !!m && typeof m === 'object' && typeof m.timestamp === 'number' && typeof m.label === 'string'
}

/**
 * 读出整份列表并排序：auto 置顶，其余按时间倒序。整份解析失败（非 JSON / 非数组）→ 空列表；
 * 数组里个别元素形状非法 → 只丢那一条，其余照常返回——`writeSave` 是「读全量 → 过滤 → 全量覆写」，
 * 若这里改用 `every` 整份判空，一条坏记录会在下次任意一次自动存档时把全部好档一起覆写没。
 */
export function listSaves(key: string): ViewerSave[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return [] // localStorage 不可用（隐私模式 / 禁用）
  }
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return sortSaves(parsed.filter(isSave))
}

function sortSaves(saves: ViewerSave[]): ViewerSave[] {
  return [...saves].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'auto' ? -1 : 1
    return b.meta.timestamp - a.meta.timestamp
  })
}

/** 落一整份列表；配额满 / 不可用 → false（调用方提示，不阻断阅读）。 */
function putAll(key: string, saves: ViewerSave[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(saves))
    return true
  } catch {
    return false
  }
}

/** 写入 / 覆盖一条存档（按 id）。返回是否成功。 */
export function writeSave(key: string, save: ViewerSave): boolean {
  const rest = listSaves(key).filter((s) => s.id !== save.id)
  return putAll(key, [...rest, save])
}

/** 删一条存档。返回是否成功（与 writeSave 同口径：配额满 / 不可用 → false）。 */
export function deleteSave(key: string, id: string): boolean {
  return putAll(key, listSaves(key).filter((s) => s.id !== id))
}

/** 键是否被写过（区别于「写过但列表为空」）。localStorage 不可用时当作写过——不可用时迁移也做不了。 */
function keyExists(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null
  } catch {
    return true
  }
}

/**
 * 名→id 一次性迁移：作者补上 id 重新导出后，读者的进度还留在旧的故事名键里。
 * id 键**从未被写过**时，把故事名键的整份列表**复制**过去；旧键保留不删——同名的另一份作品
 * 日后升级时同样要从那里复制一份，搬走即删会让先打开的一方独吞旧档、另一方凭空从头开始。
 *
 * 幂等条件是「id 键从未被写过」，而非「id 键当前没有存档」：读者可以在面板里把存档删光（`auto`
 * 那条也带删除按钮），删光后键里留的是一个空列表。若按「没有存档」判，旧键又恒不删除，那么每次
 * 删光再刷新都会把删掉的档从旧键复制回来，读者永远删不掉它们。
 */
export function migrateByTitle(idKey: string, title: string): void {
  const titleKey = savesKey(undefined, title)
  if (idKey === titleKey) return // 无 id 的老导出：两个键本就是同一个
  if (keyExists(idKey)) return
  const old = listSaves(titleKey)
  if (old.length === 0) return
  // 写失败（配额满）静默：旧键仍在，读者的档没丢。但也别把它当成「下次加载必然重试」——
  // 紧随其后的 migrateLegacy 若写成了这个键，键就算被写过，此后不再复制。窄且无害：那种情况下
  // 读者手上已有一条可续读的进度。
  putAll(idKey, old)
}

/**
 * 旧键（`kiny-progress:<名>@<版本>`）一次性迁移。优先转当前版本那条；没有当前版本、而旧键
 * **恰好只有一条**时，也拿它当 auto——多于一条则无从判断哪条最新，只能全删。
 *
 * 之所以放宽到「唯一一条」也转：旧键按版本分桶，但迁移代码跑在新构建上，新构建判定存档
 * 可达与否已改成「能不能重放成功」而非「版本号是否相等」。作者升级 Kiny 后顺手把 manifest
 * 版本号从 1.0.0 改到 1.1.0 是最常见的升级路径——若仍要求版本号完全相等才转，读者手上那条
 * 大概率重放得好好的 1.0.0 进度会被直接删掉，且过渡期只有这一次，错过就永久错过。放宽是
 * 安全的：读档本就有重放闸门兜底（`appliedCount` 校验），转错了也只是多一次「故事已更新」。
 *
 * 幂等：已有存档时不覆盖。
 */
export function migrateLegacy(key: string, title: string, version: string): void {
  const mine = `${LEGACY_PREFIX}${title}@`
  let keys: string[]
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(mine))
  } catch {
    return
  }
  if (keys.length === 0) return

  const current = `${mine}${version}`
  const migrateKey = keys.includes(current) ? current : keys.length === 1 ? keys[0] : null
  const hasSaves = listSaves(key).length > 0
  for (const k of keys) {
    if (k === migrateKey && !hasSaves) {
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? '') as unknown
        const o = v as Record<string, unknown>
        if (o && typeof o.seed === 'number' && Array.isArray(o.seq) && o.seq.every(isStep)) {
          writeSave(key, {
            id: AUTO_SAVE_ID,
            kind: 'auto',
            seed: o.seed,
            seq: o.seq as InteractionStep[],
            meta: { timestamp: Date.now(), label: '（续读）' },
          })
        }
      } catch {
        /* 旧数据损坏：丢弃即可，读者从头开始 */
      }
    }
    try {
      localStorage.removeItem(k)
    } catch {
      /* no-op */
    }
  }
}

/** 预览标签：取末条叙事的纯文本片段；已结束 →「（已结束）」；无叙事 →「开始」。截断到 ~24 字。口径同 reader / shelf。 */
export function previewLabel(play: PlayState): string {
  if (play.ended) return '（已结束）'
  for (let i = play.log.length - 1; i >= 0; i--) {
    const e = play.log[i]
    if (e.kind === 'narration') {
      const text = plainText(e.spans).trim().replace(/\s+/g, ' ')
      if (text) return text.length > 24 ? text.slice(0, 24) + '…' : text
    }
  }
  return '开始'
}

/** 生成手动存档 id（32 位十六进制，与 reader / shelf 同口径，回退时间戳 + 随机数）。 */
export function genSaveId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '')
  } catch {
    // reader / shelf 跑在受控环境（Tauri WebView / 现代浏览器），crypto.randomUUID 恒在；
    // 导出网页是长期流传的文件，会落到任意浏览器（老版本 / 非安全上下文缺 randomUUID）上。
    // 缺失时直接调用会抛 TypeError，且这段跑在 put(...) 的 try 之外，不接住会直接掀到错误
    // 边界——回退拼一段等长的 32 位十六进制，碰撞概率对存档 id 这种用途可忽略。
    const hex = (n: number, len: number) => Math.floor(n).toString(16).padStart(len, '0').slice(-len)
    return hex(Date.now(), 12) + hex(Math.random() * 0x100000000, 8) + hex(Math.random() * 0x100000000, 8) + hex(Math.random() * 0x10000, 4)
  }
}
