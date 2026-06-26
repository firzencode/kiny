import { restoreStory, plainText } from '@kiny/engine'
import type { Story, ValidatedProgram } from '@kiny/engine'
import type { PlayState } from '@kiny/player'
import type { SaveRecord } from './types'

/** 预览标签：取末条叙事的纯文本片段；已结束 →「（已结束）」；无叙事 →「开始」。截断到 ~24 字。 */
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

/**
 * 捕获一条存档：引擎 `serialize()` 快照 + 当前 PlayState + 元信息。
 * `story` 须处于稳定边界（等待选择 / 已结束），否则 serialize 抛错（调用方在推进后调用）。
 */
export function captureSave(
  story: Story,
  play: PlayState,
  kind: SaveRecord['kind'],
  id: string,
  timestamp: number,
): SaveRecord {
  return {
    id,
    kind,
    snapshot: story.serialize(),
    play,
    meta: { timestamp, label: previewLabel(play) },
  }
}

export type RestoreOutcome =
  | { ok: true; story: Story; play: PlayState }
  | { ok: false; reason: 'fingerprint-mismatch' | 'corrupt' }

/**
 * 恢复一条存档：从（同一份 .kin 重装的）program + 快照重建 Story（续推用），
 * 配回存档里的 PlayState（渲染当前屏）。fingerprint 失配 / 损坏 → 优雅降级，交调用方提示。
 */
export function restoreSave(program: ValidatedProgram, save: SaveRecord): RestoreOutcome {
  const res = restoreStory(program, save.snapshot)
  if (!res.ok) return res
  return { ok: true, story: res.story, play: save.play }
}
