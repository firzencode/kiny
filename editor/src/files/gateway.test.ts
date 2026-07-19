import { describe, it, expect } from 'vitest'
import {
  defaultKipName,
  defaultWebpageDirName,
  buildProjectData,
  starterManifest,
  sanitizeProjectBase,
  projectFolderName,
  assertRenameSafe,
  type Manifest,
} from './gateway'

describe('assertRenameSafe（两 gateway 共享的 renamePath 前置守卫）', () => {
  it('合法改名不抛', () => {
    expect(() => assertRenameSafe('a/x.kin', 'a/y.kin')).not.toThrow()
    expect(() => assertRenameSafe('sub', 'renamed')).not.toThrow()
  })
  it('非法路径（.. 穿越 / 绝对 / 空）抛', () => {
    expect(() => assertRenameSafe('../x', 'y')).toThrow()
    expect(() => assertRenameSafe('x', '/abs')).toThrow()
    expect(() => assertRenameSafe('', 'y')).toThrow()
  })
  it('目标是源自身或源子树 → 抛「不能移入自身」', () => {
    expect(() => assertRenameSafe('a', 'a')).toThrow('不能移入自身')
    expect(() => assertRenameSafe('a', 'a/b')).toThrow('不能移入自身')
  })
})

describe('defaultKipName', () => {
  it('正常故事名加 .kip 后缀', () => {
    expect(defaultKipName('雾港之夜')).toBe('雾港之夜.kip')
  })
  it('过滤 Windows 文件名非法字符', () => {
    expect(defaultKipName('a/b:c*?"<>|\\d')).toBe('abcd.kip')
  })
  it('空名或全非法字符回退为 story', () => {
    expect(defaultKipName('   ')).toBe('story.kip')
    expect(defaultKipName('/\\:*?')).toBe('story.kip')
  })
})

describe('defaultWebpageDirName', () => {
  it('故事名加 -web 后缀', () => {
    expect(defaultWebpageDirName('雾港之夜')).toBe('雾港之夜-web')
  })
  it('过滤 Windows 文件名非法字符', () => {
    expect(defaultWebpageDirName('a/b:c*?"<>|\\d')).toBe('abcd-web')
  })
  it('空名回退为 story-web', () => {
    expect(defaultWebpageDirName('   ')).toBe('story-web')
  })
})

describe('buildProjectData', () => {
  const manifest: Manifest = { name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }

  it('组装 manifest 文本 + 各 .kin 源码，assetBase 空', () => {
    const json = buildProjectData(manifest, [
      { path: 'main.kin', source: '开场\n-> 末' },
      { path: '末.kin', source: '=== 末 ===\n-> END' },
    ])
    const data = JSON.parse(json) as { manifest: string; files: Record<string, string>; assetBase: string }
    expect(JSON.parse(data.manifest)).toEqual(manifest)
    expect(data.files).toEqual({ 'main.kin': '开场\n-> 末', '末.kin': '=== 末 ===\n-> END' })
    expect(data.assetBase).toBe('')
  })

  it('转义 < > & 防止 .kin 文本里的 </script> 截断内联脚本（仍为合法 JSON、可往返）', () => {
    const json = buildProjectData(manifest, [{ path: 'main.kin', source: '教程：写 </script> 与 a<b & c>d' }])
    // 原始字节不得含闭合标签或裸 < & >，否则注入 index.html 的 <script> 被提前截断
    expect(json).not.toContain('</script>')
    expect(json).not.toContain('<')
    expect(json).not.toContain('>')
    expect(json).toContain('\\u003c')
    // \uXXXX 是合法 JSON 转义，往返还原原文
    const data = JSON.parse(json) as { files: Record<string, string> }
    expect(data.files['main.kin']).toBe('教程：写 </script> 与 a<b & c>d')
  })
})

describe('sanitizeProjectBase', () => {
  it('去非法字符与首尾空白，可为空', () => {
    expect(sanitizeProjectBase(' 雾港/夜 ')).toBe('雾港夜')
    expect(sanitizeProjectBase('  /:*?  ')).toBe('')
  })
})

describe('projectFolderName', () => {
  it('sanitize 结果非空时原样返回', () => {
    expect(projectFolderName(' 雾港/夜 ')).toBe('雾港夜')
  })
  it('sanitize 后为空 → 回退 project', () => {
    expect(projectFolderName('  /:*?  ')).toBe('project')
  })
})

describe('starterManifest', () => {
  it('engine 取注入的 Kiny 版本', () => {
    expect(starterManifest('我的故事').engine).toBe(__KINY_VERSION__)
  })
})
