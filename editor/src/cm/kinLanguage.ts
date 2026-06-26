/**
 * Kin 语言的 CM6 `StreamLanguage`（路 A）。
 *
 * 复用现有行级 tokenizer：每行行首调 `editor/src/syntax/kin.ts` 的 `tokenizeLine`，
 * 缓存结果，逐 token 推进 stream、按 cls 吐出 CM token 名。正则逻辑一字未改，
 * 避免「同一门语言两套语法定义」。代价：无完整语法树（折叠 / 补全另在路 A 上补）。
 */
import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { tokenizeLine, type Token } from '../syntax/kin'
import { clsToToken, kinTokenTable } from './highlight'

interface KinStreamState {
  tokens: Token[] | null
  idx: number
}

export const kinStreamParser: StreamParser<KinStreamState> = {
  name: 'kin',
  startState: () => ({ tokens: null, idx: 0 }),
  token(stream, state) {
    // 行首：重算整行 token 并缓存（正则 tokenizer 是行级的）。
    if (stream.sol() || state.tokens === null) {
      state.tokens = tokenizeLine(stream.string)
      state.idx = 0
    }
    const tok = state.tokens[state.idx]
    if (!tok) {
      // 防御：位置对不上（不应发生）——吞到行尾、无样式。
      stream.skipToEnd()
      return null
    }
    state.idx++
    // 按 token 文本长度推进 stream（StringStream.pos 可直接前移）。
    stream.pos += tok.text.length
    if (stream.pos > stream.string.length) stream.pos = stream.string.length
    return clsToToken(tok.cls)
  },
  tokenTable: kinTokenTable,
}

export const kinLanguage = StreamLanguage.define(kinStreamParser)
