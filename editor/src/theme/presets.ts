import { setTokenValue, scanThemeCss } from './scan'

/**
 * 预置主题：换整套风格的加速器。
 *
 * 主题定义就是**一组 token 键值**，随 editor 内置——不需要新的数据结构，也不产生新文件。
 * 零目录约定下多套主题文件共存会按字典序叠加，故只改当前这一个文件的内容。
 *
 * 套用走 T088 的**定点替换**：批量改写涉及的 token 值、文件中缺失的追加进 `.player` 块，
 * **不覆盖整个文件**，作者的注释与自定义样式原样保留——因此不需要备份文件。
 */

export interface ThemePreset {
  name: string
  /** 一句话说明这套风格给谁用。 */
  blurb: string
  tokens: Record<string, string>
}

/**
 * 每套预置必须设**同一组** token：少设一个，从 A 换到 B 就会留下 A 的残值，配色关系错乱。
 *
 * 面板类（`--kiny-panel-*`）**不在其列**——播放层里它们由 `--kiny-text` 推导，改了正文色自动跟随；
 * 硬写反而切断这条联动。其余不推导的（控件、强调、错误、底图遮罩）必须给全：播放层的默认值是
 * 为暗色底调的（白字白边），落在浅色底上根本看不见。
 */
export const PRESET_TOKENS = [
  '--kiny-page-bg',
  '--kiny-text',
  '--kiny-prose-font',
  '--kiny-prose-size',
  '--kiny-prose-line-height',
  '--kiny-content-max-width',
  '--kiny-bg-overlay',
  '--kiny-control-bg',
  '--kiny-control-bg-hover',
  '--kiny-control-text',
  '--kiny-control-border',
  '--kiny-accent',
  '--kiny-error',
] as const

const SANS = 'system-ui, "Noto Sans SC", sans-serif'

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: '石墨夜',
    blurb: '播放层原生外观：冷灰底、无衬线、行距舒展',
    tokens: {
      '--kiny-page-bg': '#0d1117',
      '--kiny-text': '#e8e8e8',
      '--kiny-prose-font': SANS,
      '--kiny-prose-size': '1.05rem',
      '--kiny-prose-line-height': '1.9',
      '--kiny-content-max-width': '680px',
      '--kiny-bg-overlay': 'rgba(10, 14, 20, .55)',
      '--kiny-control-bg': 'rgba(255, 255, 255, .06)',
      '--kiny-control-bg-hover': 'rgba(255, 255, 255, .14)',
      '--kiny-control-text': '#ffffff',
      '--kiny-control-border': 'rgba(255, 255, 255, .35)',
      '--kiny-accent': 'rgba(255, 255, 255, .8)',
      '--kiny-error': '#ff8585',
    },
  },
  {
    name: '暖纸',
    blurb: '米黄纸感、衬线字、宽栏——长篇正文最耐读',
    tokens: {
      '--kiny-page-bg': '#f6f1e6',
      '--kiny-text': '#2f2822',
      '--kiny-prose-font': 'serif',
      '--kiny-prose-size': '1.1rem',
      '--kiny-prose-line-height': '1.95',
      '--kiny-content-max-width': '700px',
      '--kiny-bg-overlay': 'rgba(246, 241, 230, .62)',
      '--kiny-control-bg': 'rgba(47, 40, 34, .05)',
      '--kiny-control-bg-hover': 'rgba(47, 40, 34, .11)',
      '--kiny-control-text': '#2f2822',
      '--kiny-control-border': 'rgba(47, 40, 34, .55)',
      '--kiny-accent': 'rgba(47, 40, 34, .7)',
      '--kiny-error': '#b03a2e',
    },
  },
  {
    name: '午夜蓝',
    blurb: '深蓝夜色、行距更松——悬疑与科幻的底子',
    tokens: {
      '--kiny-page-bg': '#0f1524',
      '--kiny-text': '#d8e1f2',
      '--kiny-prose-font': SANS,
      '--kiny-prose-size': '1.05rem',
      '--kiny-prose-line-height': '2.05',
      '--kiny-content-max-width': '660px',
      '--kiny-bg-overlay': 'rgba(9, 14, 28, .6)',
      '--kiny-control-bg': 'rgba(150, 180, 235, .09)',
      '--kiny-control-bg-hover': 'rgba(150, 180, 235, .18)',
      '--kiny-control-text': '#eaf0fb',
      '--kiny-control-border': 'rgba(150, 180, 235, .5)',
      '--kiny-accent': 'rgba(160, 190, 240, .85)',
      '--kiny-error': '#ff9a92',
    },
  },
  {
    name: '素白',
    blurb: '纯白窄栏、字号收紧——干净利落，像一页打印稿',
    tokens: {
      '--kiny-page-bg': '#ffffff',
      '--kiny-text': '#24282e',
      '--kiny-prose-font': SANS,
      '--kiny-prose-size': '1rem',
      '--kiny-prose-line-height': '1.85',
      '--kiny-content-max-width': '620px',
      '--kiny-bg-overlay': 'rgba(255, 255, 255, .68)',
      '--kiny-control-bg': 'rgba(36, 40, 46, .04)',
      '--kiny-control-bg-hover': 'rgba(36, 40, 46, .1)',
      '--kiny-control-text': '#24282e',
      '--kiny-control-border': 'rgba(36, 40, 46, .55)',
      '--kiny-accent': 'rgba(36, 40, 46, .68)',
      '--kiny-error': '#c0392b',
    },
  },
]

/**
 * 把一套预置主题套进文件：逐个 token 走定点替换（缺的追加进 `.player` 块）。
 * 文件解析不了则原样返回——与单个 token 的写回同口径，绝不整块重写作者的文件。
 */
export function applyPreset(text: string, preset: ThemePreset): string {
  if (!scanThemeCss(text).ok) return text
  let next = text
  for (const name of PRESET_TOKENS) {
    const value = preset.tokens[name]
    if (value !== undefined) next = setTokenValue(next, name, value)
  }
  return next
}
