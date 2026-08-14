import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { Player } from '../components/Player'
import { initialState, type PlayState } from '../driver/storyDriver'
import { parseCharacters } from './table'

const table = parseCharacters('{"阿黎娅":{"color":"#7fb3d5"}}', { autoColor: true })
const LINE = '阿黎娅：外面在下雨。'
const SPEAKER_COLOR = 'rgb(127, 179, 213)'

function stateWith(over: Partial<PlayState>): PlayState {
  return { ...initialState, ...over }
}

describe('Player 渲染入口着色', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /**
   * 这条是本特性最容易做错的地方：最新一行走 `RevealingLine` 逐字揭示、**绕开 `RichText`**。
   * 着色若做在 `RichText` 里，正在打字的那行就不着色、打完才跳成彩色。
   */
  it('揭示中的最新一行（RevealingLine 路径）逐字都带角色色', () => {
    render(
      <Player
        state={stateWith({ log: [{ kind: 'narration', spans: [{ text: LINE }] }] })}
        onChoose={() => {}}
        characters={table}
        reveal={{ speed: 10, fade: 0 }}
      />,
    )
    act(() => { vi.advanceTimersByTime(350) })

    const revealing = document.querySelector('.narration-reveal')
    expect(revealing).not.toBeNull()
    const chars = [...revealing!.querySelectorAll('span')]
    // 确认此刻确实还在揭示中（只出了一部分字），而不是已经定格成 RichText
    expect(chars.length).toBeGreaterThan(0)
    expect(chars.length).toBeLessThan([...LINE].length)
    for (const el of chars) expect(el.style.color).toBe(SPEAKER_COLOR)
  })

  it('定格后的行（RichText 路径）同样带角色色，旁白不带', () => {
    render(
      <Player
        state={stateWith({
          log: [
            { kind: 'narration', spans: [{ text: '雾散了，港口露出轮廓。' }] },
            { kind: 'narration', spans: [{ text: LINE }] },
          ],
        })}
        onChoose={() => {}}
        characters={table}
      />,
    )
    const colored = [...document.querySelectorAll('span')].filter((el) => el.style.color === SPEAKER_COLOR)
    expect(colored.map((el) => el.textContent)).toEqual([LINE])
  })

  it('不传 characters 时一行不着色（现有行为不变）', () => {
    render(
      <Player
        state={stateWith({ log: [{ kind: 'narration', spans: [{ text: LINE }] }] })}
        onChoose={() => {}}
      />,
    )
    expect([...document.querySelectorAll('span')].filter((el) => el.style.color !== '')).toHaveLength(0)
  })
})
