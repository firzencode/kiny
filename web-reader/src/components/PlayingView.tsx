import type { Story } from '@kiny/engine'
import { Player, usePlayback, type ResolveAsset } from '@kiny/player'

/**
 * 驱动壳：usePlayback 持有 Story，逐行 step 推进 + 打字机揭示 + stepMode 分派（flow 自动续 / line 等点击）。
 * 首帧推进与 StrictMode 双调用由 usePlayback 内部守卫处理。
 */
export function PlayingView({ story, resolveAsset }: { story: Story; resolveAsset: ResolveAsset }) {
  const pb = usePlayback(story, resolveAsset)
  return (
    <Player state={pb.state} sfx={pb.sfx} reveal={pb.reveal} onChoose={pb.onChoose} onSubmitInput={pb.onSubmitInput} onContentClick={pb.onContentClick} />
  )
}
