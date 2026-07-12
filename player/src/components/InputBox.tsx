import { useState } from 'react'

/**
 * 读者文本输入框（@input 暂停点）：单行文本框 + 提交按钮，Enter 亦提交。
 * 与选项列表对偶、互斥（同一时刻至多渲染其一）。
 * onSubmit 缺省时禁用（如 editor 预览暂不支持提交）——仅展示输入框形态 + 提示。
 */
export function InputBox({
  placeholder, onSubmit,
}: {
  placeholder: string | null
  onSubmit?: (text: string) => void
}) {
  const [text, setText] = useState('')
  const disabled = onSubmit == null
  return (
    <form
      className="input-box"
      onClick={(e) => e.stopPropagation()} // 点输入框内部不冒泡到正文区（避免触发逐行推进 / 跳过）
      onSubmit={(e) => {
        e.preventDefault()
        if (disabled) return
        onSubmit(text)
        setText('')
      }}
    >
      <input
        className="input-box-field"
        type="text"
        value={text}
        placeholder={placeholder ?? undefined}
        disabled={disabled}
        autoFocus={!disabled}
        onChange={(e) => setText(e.target.value)}
        aria-label={placeholder ?? '输入'}
      />
      <button className="input-box-submit" type="submit" disabled={disabled}>确定</button>
      {disabled && <span className="input-box-hint">（预览暂不支持输入，请在阅读器中体验）</span>}
    </form>
  )
}
