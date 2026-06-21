import type { OutputEvent } from '@kiny/engine'

type CommandEvent = Extract<OutputEvent, { kind: 'command' }>

/** 把资源文件名解析为可用 URL（web 拼 base、editor 走 convertFileSrc、测试给桩）。平台中立落点。 */
export type ResolveAsset = (filename: string) => string

/** 宿主当前的视觉/音频意图。纯数据，由 React effect 落地为真实副作用。 */
export interface HostState {
  bg: string | null
  bgm: { src: string; playing: boolean } | null
}

export const emptyHost: HostState = { bg: null, bgm: null }

/** spec §11.1 五命令 → HostState 转移。意外命令原样返回。纯函数。 */
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
    default:
      console.warn(`player: 未实现的命令 @${e.name}`)
      return s
  }
}
