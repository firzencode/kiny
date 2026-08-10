import { useEffect, useRef, useState } from 'react'

interface DraftInputProps {
  id: string
  /** 文件里的当前值（外部真相）。 */
  value: string
  disabled?: boolean
  /** 提交（失焦 / 回车）时调用；打字过程中**不**调用。 */
  onCommit: (next: string) => void
}

/**
 * 「打字不写盘、失焦或回车才提交」的文本输入。
 *
 * 主题 GUI 里，控件是取色器 / 滑杆还是文本框，是**按文件当前值**判定的；而受控文本框若
 * 每敲一个字就写回文件，两者一叠加就出两件事：
 *
 * - 打 `#0d1117` 打到第四个字符 `#0d1` 时，它已经是个合法的三位色 → 判定翻转 → 文本框
 *   当场被换成取色器、焦点丢失，文件里留下截断值。六位色因此根本打不进去（行高打不出
 *   `1.55` 同理）。
 * - 打一个 `"` 或 `}`，文件当场变成扫描器读不懂的样子 → 整个「外观」页塌成告警面板，
 *   而这段坏文本正是编辑器自己一个字一个字写进去的。
 *
 * 故：草稿留在组件本地，只有提交时才动文件——打字期间文件不变，控件形态的判定也就不会
 * 中途翻转，文件也不会经历「半截值」。代价是这一路输入没有逐字的实时预览（取色器 / 滑杆
 * 那条常用路径不受影响，仍是即时的）。提交前外部值变了（切文件、AI 改写、套预置）则丢弃
 * 草稿跟上外部。Esc 放弃本次编辑。
 */
export function DraftInput({ id, value, disabled, onCommit }: DraftInputProps) {
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)

  // 外部值变化时同步——但正在打字就别抢，否则每次重渲染都把草稿冲掉。
  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  const commit = () => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <input
      id={id}
      className="theme-text"
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focusedRef.current = true }}
      onBlur={() => { focusedRef.current = false; commit() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        else if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() }
      }}
    />
  )
}
