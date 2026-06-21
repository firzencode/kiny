import { describe, it, expect } from 'vitest'
import * as engine from './index'

describe('@kiny/engine 公共导出面', () => {
  it('暴露核心值符号', () => {
    for (const name of [
      'parse', 'ParseError',
      'analyze', 'resolveStart', 'openingKnotName',
      'createStory', 'Story', 'RuntimeError',
      'validateManifest', 'assembleProject', 'loadProjectFromFiles',
    ]) {
      expect(engine).toHaveProperty(name)
    }
  })
  it('不暴露 fs 扫盘的 loadProject（它属于 cli）', () => {
    expect(engine).not.toHaveProperty('loadProject')
  })
})
