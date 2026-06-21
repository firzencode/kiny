import { describe, it, expect } from 'vitest'
import type { OutputEvent } from '@kiny/engine'
import { emptyHost, applyCommand, type ResolveAsset } from './commands'

const cmd = (name: string, args: unknown[]): Extract<OutputEvent, { kind: 'command' }> => ({
  kind: 'command', name, args,
})
const RESOLVE: ResolveAsset = (name) => 'demo/assets/' + name

describe('applyCommand', () => {
  it('bg_show 设背景图 URL（经 resolveAsset）', () => {
    expect(applyCommand(emptyHost, cmd('bg_show', ['harbor.jpg']), RESOLVE).bg).toBe('demo/assets/harbor.jpg')
  })
  it('bg_hide 清背景', () => {
    const shown = applyCommand(emptyHost, cmd('bg_show', ['a.jpg']), RESOLVE)
    expect(applyCommand(shown, cmd('bg_hide', []), RESOLVE).bg).toBeNull()
  })
  it('bgm_play 设音乐意图为 playing', () => {
    expect(applyCommand(emptyHost, cmd('bgm_play', ['loop.mp3']), RESOLVE).bgm).toEqual({
      src: 'demo/assets/loop.mp3', playing: true,
    })
  })
  it('bgm_pause 保留 src、置 playing=false', () => {
    const playing = applyCommand(emptyHost, cmd('bgm_play', ['loop.mp3']), RESOLVE)
    expect(applyCommand(playing, cmd('bgm_pause', []), RESOLVE).bgm).toEqual({
      src: 'demo/assets/loop.mp3', playing: false,
    })
  })
  it('bgm_stop 清音乐', () => {
    const playing = applyCommand(emptyHost, cmd('bgm_play', ['loop.mp3']), RESOLVE)
    expect(applyCommand(playing, cmd('bgm_stop', []), RESOLVE).bgm).toBeNull()
  })
  it('bgm_pause 在无音乐时不崩、保持 null', () => {
    expect(applyCommand(emptyHost, cmd('bgm_pause', []), RESOLVE).bgm).toBeNull()
  })
  it('意外命令原样返回、不崩', () => {
    expect(applyCommand(emptyHost, cmd('unknown_cmd', []), RESOLVE)).toEqual(emptyHost)
  })
  it('不修改入参（纯）', () => {
    const before = { ...emptyHost }
    applyCommand(emptyHost, cmd('bg_show', ['a.jpg']), RESOLVE)
    expect(emptyHost).toEqual(before)
  })
})
