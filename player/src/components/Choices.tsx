import type { ChoiceView } from '@kiny/engine'
import { RichText } from './RichText'

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
        // stopPropagation：选项点击不得冒泡到 .player-content 的推进/跳过 handler
        //（chooseStep 同步开始新行揭示后，冒泡会递增 skipToken 把新行瞬显；与 InputBox 防御一致）。
        <button key={c.index} className="choice" onClick={(e) => { e.stopPropagation(); onChoose(c.index) }}>
          <RichText spans={c.spans} />
        </button>
      ))}
    </div>
  )
}
