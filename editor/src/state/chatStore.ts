// AI 对话历史持久化（spec 2026-07-01-editor-ai-chat-persistence）。
// 纯逻辑 + 损坏降级 + 按日期清理，仿 drafts.ts / session.ts。对话按项目分桶，
// 每项目一个文件 <AppData>/ai-chats/<projectKey>.json（IO 在 gateway，本模块只做数据）。
//
// 序列化白名单（不变量，防隐私泄露 spec §6）：ChatStore 只含 version / projectDir /
// conversations；Conversation 只含 id / title / createdAt / lastActivityAt / turns / history。
// 绝不序列化 AiConfig（含 apiKey）——key 活在另一 localStorage key，从不进对话数据。

import type { AiTurn } from '../ai/useAiSession'
import type { Message } from '../ai/provider'
import { hashSource } from './drafts'

/** 一个会话：UI 真相（turns）+ 续话真相（history），两份都存、互不依赖、零重建。 */
export interface Conversation {
  id: string
  /** 自动取首条用户 prompt 截断；空对话为「新对话」。 */
  title: string
  createdAt: number
  /** 最后一次新增内容的时间戳 —— 按日期自动清理的依据。 */
  lastActivityAt: number
  turns: AiTurn[]
  /** 喂 LLM 的续话消息（已剔除 system，见 provider.ts）。 */
  history: Message[]
}

/** 某项目下的全部会话。 */
export interface ChatStore {
  version: 1
  /** 原始项目路径（projectKey 是其 hash），可读 / 校验。 */
  projectDir: string
  conversations: Conversation[]
}

export const CHAT_VERSION = 1
export const NEW_CONVERSATION_TITLE = '新对话'
/** 标题截断上限（字符数）。 */
export const TITLE_MAX = 40
export const MS_PER_DAY = 24 * 60 * 60 * 1000

export function emptyChatStore(projectDir: string): ChatStore {
  return { version: CHAT_VERSION, projectDir, conversations: [] }
}

export function toChatStore(projectDir: string, conversations: Conversation[]): ChatStore {
  return { version: CHAT_VERSION, projectDir, conversations }
}

/** 项目路径 → 稳定文件名（djb2 hex，规避路径里的非法文件名字符）。 */
export function projectKey(projectDir: string): string {
  return hashSource(projectDir)
}

/** 首条用户 prompt → 标题：去首尾空白、压缩内部空白、截断；空则「新对话」。 */
export function titleFromPrompt(prompt: string): string {
  const t = prompt.trim().replace(/\s+/g, ' ')
  if (t === '') return NEW_CONVERSATION_TITLE
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t
}

/** 新建空会话（title=新对话，两时间戳=now）。 */
export function makeConversation(id: string, now: number): Conversation {
  return { id, title: NEW_CONVERSATION_TITLE, createdAt: now, lastActivityAt: now, turns: [], history: [] }
}

/** 一条会话的形状校验（解析降级用）：字段齐、类型对才收。 */
function isValidConversation(c: unknown): c is Conversation {
  if (!c || typeof c !== 'object') return false
  const o = c as Record<string, unknown>
  return typeof o.id === 'string'
    && typeof o.title === 'string'
    && typeof o.createdAt === 'number'
    && typeof o.lastActivityAt === 'number'
    && Array.isArray(o.turns)
    && Array.isArray(o.history)
}

/** 解析持久化文本；无 / 损坏 / 版本不符 → null（调用方回退 emptyChatStore）。 */
export function parseChatStore(raw: string | null): ChatStore | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== CHAT_VERSION || typeof parsed.projectDir !== 'string'
      || !Array.isArray(parsed.conversations)) {
      return null
    }
    // 逐条过滤掉形状不合法的会话（部分损坏时仍尽量保留可用会话）。
    const conversations = (parsed.conversations as unknown[]).filter(isValidConversation) as Conversation[]
    return { version: CHAT_VERSION, projectDir: parsed.projectDir, conversations }
  } catch {
    return null
  }
}

/** 载回时把残留的 running 轮重置为 false（防崩溃中途持久化的轮显示为卡死）。 */
export function sanitizeLoadedConversations(conversations: Conversation[]): Conversation[] {
  return conversations.map((c) => ({
    ...c,
    turns: c.turns.map((t) => (t.running ? { ...t, running: false } : t)),
  }))
}

/** 会话列表按 lastActivityAt 倒序（最近在前），用于历史列表呈现。返回新数组。 */
export function sortByRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

/** 最近活动会话的 id；空列表 → null。 */
export function mostRecentId(conversations: Conversation[]): string | null {
  let best: Conversation | null = null
  for (const c of conversations) if (!best || c.lastActivityAt > best.lastActivityAt) best = c
  return best?.id ?? null
}

/** 硬删某会话（无回收站）。返回新数组。 */
export function deleteConversation(conversations: Conversation[], id: string): Conversation[] {
  return conversations.filter((c) => c.id !== id)
}

/**
 * 按日期清理：删除 lastActivityAt 距今超过 retentionDays 的会话。
 * retentionDays === null → 关闭清理，原样返回。返回新 store。
 */
export function pruneExpired(store: ChatStore, retentionDays: number | null, now: number): ChatStore {
  if (retentionDays === null) return store
  const cutoff = now - retentionDays * MS_PER_DAY
  const conversations = store.conversations.filter((c) => c.lastActivityAt >= cutoff)
  return conversations.length === store.conversations.length ? store : { ...store, conversations }
}

/** 相对时间短标签（历史列表用）：刚刚 / N 分钟前 / N 小时前 / N 天前 / N 月前。 */
export function relativeTime(ts: number, now: number): string {
  const d = Math.max(0, now - ts)
  const min = Math.floor(d / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}
