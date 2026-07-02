import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { findManifest } from '@kiny/engine'
import { assembleStory } from './assembleStory'

// 从仓库唯一权威样例读《雾港之夜》文本（engine 纯库不读 assets）
const SAMPLE = join(__dirname, '../../../samples/雾港之夜')

function loadSampleFiles(): { manifestText: string; files: Map<string, string>; manifestName: string } {
  const names = readdirSync(SAMPLE)
  const found = findManifest(names)
  if (!found.ok) throw new Error(found.message)
  const manifestText = readFileSync(join(SAMPLE, found.name), 'utf8')
  const files = new Map<string, string>()
  for (const name of names) {
    if (name.endsWith('.kin')) files.set(name, readFileSync(join(SAMPLE, name), 'utf8'))
  }
  return { manifestText, files, manifestName: found.name }
}

describe('assembleStory', () => {
  it('用真实样例《雾港之夜》建出可推进的 Story', () => {
    const { manifestText, files, manifestName } = loadSampleFiles()
    const out = assembleStory(manifestText, files, 1, manifestName)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.title).toBe('雾港之夜')
    expect(out.story.canContinue).toBe(true) // 入口起即有内容
  })

  it('manifest 非法 JSON → 报错', () => {
    const out = assembleStory('{ not json', new Map())
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected failure')
    expect(out.message).toContain('kiny.json')
  })

  it('缺入口文件 → 报错', () => {
    const manifestText = JSON.stringify({ name: 'X', version: '1', engine: '0.1.0', entry: 'main.kin' })
    const out = assembleStory(manifestText, new Map())
    expect(out.ok).toBe(false)
  })
})
