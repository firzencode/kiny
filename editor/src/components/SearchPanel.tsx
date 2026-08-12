import { useEffect, useMemo, useRef, useState } from 'react'
import { groupByFile, replaceInText, searchBuffers, type SearchMatch, type SearchOptions } from '../search/projectSearch'

/**
 * 项目级搜索面板（编辑区底部，Ctrl/Cmd+Shift+F 唤起）。
 * 搜索作用于编辑缓冲（含未保存改动）；替换按字面文本逐文件落脏标记（由 App 统一 dispatch）。
 */
export function SearchPanel({
  buffers,
  onJump,
  onApplyReplace,
}: {
  buffers: { path: string; source: string }[]
  /** 点结果跳转（文件 + 行）。 */
  onJump: (file: string, line: number) => void
  /** 单文件 / 全部文件替换回调（App 内 dispatch + notice）。 */
  onApplyReplace: (path: string | null, query: string, replacement: string, opts: SearchOptions) => void
}) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [opts, setOpts] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false })
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开面板时聚焦搜索框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const result = useMemo(() => {
    if (query === '') return { matches: [], error: null }
    try {
      return { matches: searchBuffers(buffers, query, opts), error: null }
    } catch (e) {
      return { matches: [], error: e instanceof Error ? e.message : String(e) }
    }
  }, [buffers, query, opts])

  const groups = useMemo(() => groupByFile(result.matches), [result.matches])
  const total = result.matches.length
  // 每个文件实际可替换数（与全部替换一致的口径）
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of result.matches) m.set(r.path, (m.get(r.path) ?? 0) + 1)
    return m
  }, [result.matches])

  const replaceAllIn = (path: string | null) => {
    if (query === '') return
    onApplyReplace(path, query, replacement, opts)
  }

  const toggle = (key: keyof SearchOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }))

  return (
    <div className="search-panel" role="search" aria-label="在文件中搜索">
      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="搜索项目内所有文本文件…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索内容"
        />
        <span className="search-count">{result.error !== null ? result.error : total === 0 ? '无结果' : `${total} 处命中`}</span>
      </div>
      <div className="search-row">
        <input
          className="search-input"
          placeholder="替换为…（字面文本）"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          aria-label="替换为"
        />
        <button type="button" className="search-btn" disabled={total === 0} onClick={() => replaceAllIn(null)}>
          全部替换
        </button>
      </div>
      <div className="search-opts">
        <label><input type="checkbox" checked={opts.caseSensitive ?? false} onChange={() => toggle('caseSensitive')} />Aa</label>
        <label><input type="checkbox" checked={opts.wholeWord ?? false} onChange={() => toggle('wholeWord')} />全词</label>
        <label><input type="checkbox" checked={opts.regex ?? false} onChange={() => toggle('regex')} />正则</label>
      </div>
      <div className="search-results" role="list">
        {groups.map((g) => (
          <div key={g.path} className="search-file">
            <div className="search-file-head">
              <span className="search-file-name" title={g.path}>{g.path}</span>
              <span className="search-file-count">{g.matches.length}</span>
              <button
                type="button"
                className="search-btn"
                disabled={query === '' || !counts.has(g.path)}
                onClick={() => replaceAllIn(g.path)}
                title={`替换本文件中的 ${counts.get(g.path) ?? 0} 处`}
              >
                替换本文件
              </button>
            </div>
            {g.matches.slice(0, 200).map((m, i) => (
              <ResultRow key={i} m={m} query={query} onJump={onJump} />
            ))}
            {g.matches.length > 200 && <div className="search-more">…还有 {g.matches.length - 200} 处</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultRow({ m, onJump }: { m: SearchMatch; query: string; onJump: (f: string, l: number) => void }) {
  const text = m.text.trim()
  return (
    <button
      type="button"
      className="search-hit"
      role="listitem"
      onClick={() => onJump(m.path, m.line)}
      title={`${m.path}:${m.line}`}
    >
      <span className="search-hit-line">{m.line}</span>
      <span className="search-hit-text">{text.length > 120 ? text.slice(0, 120) + '…' : text}</span>
    </button>
  )
}

/** 全部替换前的确认文案（App 用）。 */
export function replaceSummary(counts: Map<string, number>): string {
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const files = counts.size
  return `将替换 ${files} 个文件中的 ${total} 处匹配，确认继续？`
}

/** 供 App 在替换回调里直接调用的纯逻辑：对一批缓冲做全量/单文件替换，返回新源码映射。 */
export function computeReplace(
  buffers: { path: string; source: string }[],
  path: string | null,
  query: string,
  replacement: string,
  opts: SearchOptions,
): { path: string; source: string; count: number }[] {
  const out: { path: string; source: string; count: number }[] = []
  for (const b of buffers) {
    if (path !== null && b.path !== path) continue
    const r = replaceInText(b.source, query, replacement, opts)
    if (r.count > 0) out.push({ path: b.path, source: r.source, count: r.count })
  }
  return out
}
