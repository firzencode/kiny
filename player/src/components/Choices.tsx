import type { ChoiceView } from '@kiny/engine'

/** 选项按钮列表；点击把 ChoiceView.index 回传。 */
export function Choices({
  items, onChoose,
}: {
  items: ChoiceView[]
  onChoose: (index: number) => void
}) {
  return (
    <div className="choices">
      {items.map((c) => (
        <button key={c.index} className="choice" onClick={() => onChoose(c.index)}>
          {c.text}
        </button>
      ))}
    </div>
  )
}
