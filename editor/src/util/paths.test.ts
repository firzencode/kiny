import { describe, it, expect } from 'vitest'
import { parentDir, basename, underPath, entryAfterRename } from './paths'

describe('parentDir', () => {
  it('取父目录（/ 与 \\ 分隔）', () => {
    expect(parentDir('/a/b/c.kin')).toBe('/a/b')
    expect(parentDir('C:\\proj\\main.kin')).toBe('C:\\proj')
  })
  it('无分隔符原样返回', () => expect(parentDir('main.kin')).toBe('main.kin'))
})

describe('basename', () => {
  it('取末段（/ 与 \\，去尾斜杠）', () => {
    expect(basename('/a/b/c.kin')).toBe('c.kin')
    expect(basename('C:\\proj\\sub')).toBe('sub')
    expect(basename('/a/b/')).toBe('b')
  })
  it('无分隔符原样返回', () => expect(basename('x')).toBe('x'))
})

describe('underPath', () => {
  it('自身或子树为真', () => {
    expect(underPath('a/b', 'a/b')).toBe(true)
    expect(underPath('a/b/c', 'a/b')).toBe(true)
  })
  it('前缀但非路径边界为假', () => {
    expect(underPath('a/bc', 'a/b')).toBe(false)
    expect(underPath('a', 'a/b')).toBe(false)
  })
})

describe('entryAfterRename', () => {
  it('入口即被改名文件 → 新名', () => expect(entryAfterRename('main.kin', 'main.kin', 'story.kin')).toBe('story.kin'))
  it('入口在被移动目录下 → 前缀替换', () => expect(entryAfterRename('sub/main.kin', 'sub', 'chapters')).toBe('chapters/main.kin'))
  it('入口不在 from 子树下 → null（无需改）', () => {
    expect(entryAfterRename('other.kin', 'main.kin', 'story.kin')).toBeNull()
    expect(entryAfterRename('a/x.kin', 'b', 'c')).toBeNull()
  })
})
