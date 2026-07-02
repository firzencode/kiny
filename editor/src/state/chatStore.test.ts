import { describe, it, expect } from 'vitest'
import {
  emptyChatStore, toChatStore, parseChatStore, projectKey, titleFromPrompt, makeConversation,
  deleteConversation, pruneExpired, sortByRecent, mostRecentId, sanitizeLoadedConversations,
  relativeTime, CHAT_VERSION, NEW_CONVERSATION_TITLE, TITLE_MAX, MS_PER_DAY,
  type Conversation, type ChatStore,
} from './chatStore'
import type { AiTurn } from '../ai/useAiSession'
import type { Message } from '../ai/provider'

const turn = (id: number, prompt: string): AiTurn => ({ id, prompt, segments: [], running: false })
const conv = (over: Partial<Conversation>): Conversation => ({
  id: 'c1', title: '标题', createdAt: 100, lastActivityAt: 100, turns: [], history: [], ...over,
})

describe('chatStore 纯函数', () => {
  it('emptyChatStore / toChatStore 形状', () => {
    expect(emptyChatStore('/p')).toEqual({ version: CHAT_VERSION, projectDir: '/p', conversations: [] })
    const cs = [conv({ id: 'a' })]
    expect(toChatStore('/p', cs)).toEqual({ version: CHAT_VERSION, projectDir: '/p', conversations: cs })
  })

  it('projectKey 稳定且随路径不同', () => {
    expect(projectKey('/p')).toBe(projectKey('/p'))
    expect(projectKey('/p')).not.toBe(projectKey('/q'))
    // 文件名安全：无路径分隔符 / 非法字符
    expect(projectKey('C:\\Users\\x\\proj')).toMatch(/^[0-9a-f]+$/)
  })

  describe('titleFromPrompt', () => {
    it('去空白 + 压缩内部空白', () => {
      expect(titleFromPrompt('  帮我  写个   开头 ')).toBe('帮我 写个 开头')
    })
    it('空 / 纯空白 → 新对话', () => {
      expect(titleFromPrompt('')).toBe(NEW_CONVERSATION_TITLE)
      expect(titleFromPrompt('   \n ')).toBe(NEW_CONVERSATION_TITLE)
    })
    it('超长截断加省略号', () => {
      const long = 'a'.repeat(TITLE_MAX + 10)
      const t = titleFromPrompt(long)
      expect(t).toBe('a'.repeat(TITLE_MAX) + '…')
    })
  })

  it('makeConversation：空会话 + 两时间戳=now', () => {
    const c = makeConversation('x', 555)
    expect(c).toEqual({ id: 'x', title: NEW_CONVERSATION_TITLE, createdAt: 555, lastActivityAt: 555, turns: [], history: [] })
  })

  describe('parseChatStore', () => {
    it('合法文本 → store', () => {
      const store: ChatStore = { version: 1, projectDir: '/p', conversations: [conv({ id: 'a' })] }
      expect(parseChatStore(JSON.stringify(store))).toEqual(store)
    })
    it('null / 空串 / 乱码 → null', () => {
      expect(parseChatStore(null)).toBeNull()
      expect(parseChatStore('')).toBeNull()
      expect(parseChatStore('{不是 json')).toBeNull()
    })
    it('版本不符 / 缺字段 → null', () => {
      expect(parseChatStore(JSON.stringify({ version: 2, projectDir: '/p', conversations: [] }))).toBeNull()
      expect(parseChatStore(JSON.stringify({ version: 1, conversations: [] }))).toBeNull()
      expect(parseChatStore(JSON.stringify({ version: 1, projectDir: '/p' }))).toBeNull()
    })
    it('逐条剔除形状不合法的会话，保留可用的', () => {
      const raw = JSON.stringify({
        version: 1, projectDir: '/p',
        conversations: [conv({ id: 'ok' }), { id: 'bad' /* 缺字段 */ }, null],
      })
      const parsed = parseChatStore(raw)
      expect(parsed?.conversations.map((c) => c.id)).toEqual(['ok'])
    })
  })

  it('sanitizeLoadedConversations：running 轮重置为 false', () => {
    const running: AiTurn = { id: 1, prompt: 'x', segments: [], running: true }
    const cs = [conv({ turns: [running, turn(2, 'y')] })]
    const out = sanitizeLoadedConversations(cs)
    expect(out[0].turns.every((t) => !t.running)).toBe(true)
  })

  it('sortByRecent / mostRecentId：按 lastActivityAt 倒序', () => {
    const a = conv({ id: 'a', lastActivityAt: 100 })
    const b = conv({ id: 'b', lastActivityAt: 300 })
    const c = conv({ id: 'c', lastActivityAt: 200 })
    expect(sortByRecent([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(mostRecentId([a, b, c])).toBe('b')
    expect(mostRecentId([])).toBeNull()
  })

  it('deleteConversation：硬删指定 id', () => {
    const cs = [conv({ id: 'a' }), conv({ id: 'b' })]
    expect(deleteConversation(cs, 'a').map((c) => c.id)).toEqual(['b'])
    expect(deleteConversation(cs, 'zzz')).toHaveLength(2)
  })

  describe('pruneExpired', () => {
    const now = 100 * MS_PER_DAY
    const fresh = conv({ id: 'fresh', lastActivityAt: now - 5 * MS_PER_DAY })
    const stale = conv({ id: 'stale', lastActivityAt: now - 40 * MS_PER_DAY })
    it('删除超过阈值天数无新增的会话', () => {
      const out = pruneExpired({ version: 1, projectDir: '/p', conversations: [fresh, stale] }, 30, now)
      expect(out.conversations.map((c) => c.id)).toEqual(['fresh'])
    })
    it('retentionDays=null → 关闭清理，原样返回', () => {
      const store: ChatStore = { version: 1, projectDir: '/p', conversations: [fresh, stale] }
      expect(pruneExpired(store, null, now)).toBe(store)
    })
    it('无变化时返回原引用', () => {
      const store: ChatStore = { version: 1, projectDir: '/p', conversations: [fresh] }
      expect(pruneExpired(store, 30, now)).toBe(store)
    })
    it('恰好等于阈值边界保留（>=）', () => {
      const edge = conv({ id: 'edge', lastActivityAt: now - 30 * MS_PER_DAY })
      const out = pruneExpired({ version: 1, projectDir: '/p', conversations: [edge] }, 30, now)
      expect(out.conversations).toHaveLength(1)
    })
  })

  it('序列化白名单不变量：不含 apiKey / AiConfig 字段', () => {
    const store = toChatStore('/p', [conv({
      id: 'a',
      turns: [turn(1, 'hi')],
      history: [{ role: 'user', content: 'hi' } as Message, { role: 'assistant', content: 'yo' } as Message],
    })])
    const json = JSON.stringify(store)
    expect(json).not.toMatch(/apiKey/i)
    expect(json).not.toMatch(/endpoint/i)
    // store / conversation 的键恰为白名单
    expect(Object.keys(store).sort()).toEqual(['conversations', 'projectDir', 'version'])
    expect(Object.keys(store.conversations[0]).sort())
      .toEqual(['createdAt', 'history', 'id', 'lastActivityAt', 'title', 'turns'])
  })

  it('relativeTime：分级标签', () => {
    const now = 1000 * MS_PER_DAY
    expect(relativeTime(now, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60000, now)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3600000, now)).toBe('3 小时前')
    expect(relativeTime(now - 4 * MS_PER_DAY, now)).toBe('4 天前')
    expect(relativeTime(now - 40 * MS_PER_DAY, now)).toBe('1 个月前')
  })
})
