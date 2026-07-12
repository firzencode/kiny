import type { OutputEvent } from '@kiny/engine'

type CommandEvent = Extract<OutputEvent, { kind: 'command' }>

/** 把资源文件名解析为可用 URL（web 拼 base、editor 走 convertFileSrc、测试给桩）。平台中立落点。 */
export type ResolveAsset = (filename: string) => string

/** 正文推进模式：line = 逐段等点击；flow = 一路流到选项（默认）。 */
export type StepMode = 'line' | 'flow'

/** 打字机默认值（集中定义）。80 字/秒（12.5ms/字）出字利落不候读；
 * 淡入 300ms ≈ 24 字的滚动渐显窗口——不调任何参数也有可感知的柔和淡入。 */
export const DEFAULT_TEXT_SPEED = 80 // 字 / 秒
export const DEFAULT_TEXT_FADE = 300 // ms

/** 宿主当前的视觉/音频/呈现意图。纯数据，由 React effect / 播放壳落地为真实副作用。 */
export interface HostState {
  bg: string | null
  bgm: { src: string; playing: boolean } | null
  /** 正文推进模式（@step_mode），默认 flow。 */
  stepMode: StepMode
  /** 打字机出字速度（字 / 秒，@text_speed）；0 = 瞬显。 */
  textSpeed: number
  /** 每字淡入时长（ms，@text_fade）；0 = 无淡入。 */
  textFade: number
}

export const emptyHost: HostState = {
  bg: null,
  bgm: null,
  stepMode: 'flow',
  textSpeed: DEFAULT_TEXT_SPEED,
  textFade: DEFAULT_TEXT_FADE,
}

/** 非负有限数取值，否则回落。 */
function nonNeg(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** spec §11.1 命令 → HostState 转移。意外命令原样返回。纯函数。 */
export function applyCommand(s: HostState, e: CommandEvent, resolve: ResolveAsset): HostState {
  const url = (name: unknown) => resolve(String(name))
  switch (e.name) {
    case 'bg_show':
      return { ...s, bg: url(e.args[0]) }
    case 'bg_hide':
      return { ...s, bg: null }
    case 'bgm_play':
      return { ...s, bgm: { src: url(e.args[0]), playing: true } }
    case 'bgm_pause':
      return { ...s, bgm: s.bgm ? { ...s.bgm, playing: false } : null }
    case 'bgm_stop':
      return { ...s, bgm: null }
    case 'step_mode':
      return { ...s, stepMode: e.args[0] === 'line' ? 'line' : 'flow' }
    case 'text_speed':
      return { ...s, textSpeed: nonNeg(e.args[0], s.textSpeed) }
    case 'text_fade':
      return { ...s, textFade: nonNeg(e.args[0], s.textFade) }
    default:
      console.warn(`player: 未实现的命令 @${e.name}`)
      return s
  }
}
