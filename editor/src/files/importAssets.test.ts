import { describe, it, expect } from 'vitest'
import { resolveImportDir, basename, destPath, uniqueName, MEDIA_EXTS } from './importAssets'

describe('resolveImportDir', () => {
  it('root → 项目根 ""', () => { expect(resolveImportDir('root', '')).toBe('') })
  it('dir → 该目录自身', () => { expect(resolveImportDir('dir', 'ch/sub')).toBe('ch/sub') })
  it('file（根级）→ 空', () => { expect(resolveImportDir('file', 'main.kin')).toBe('') })
  it('file（子目录）→ 其父目录', () => { expect(resolveImportDir('file', 'ch/a.kin')).toBe('ch') })
})

describe('basename', () => {
  it('POSIX 绝对路径取末段', () => { expect(basename('/home/u/pic.png')).toBe('pic.png') })
  it('Windows 反斜杠路径取末段', () => { expect(basename('C:\\Users\\me\\a.mp3')).toBe('a.mp3') })
  it('无分隔符原样', () => { expect(basename('x.jpg')).toBe('x.jpg') })
})

describe('destPath', () => {
  it('根目录无前缀', () => { expect(destPath('', 'a.png')).toBe('a.png') })
  it('子目录拼前缀', () => { expect(destPath('assets/img', 'a.png')).toBe('assets/img/a.png') })
})

describe('uniqueName', () => {
  it('不冲突时原样返回', () => {
    expect(uniqueName('a.png', new Set())).toBe('a.png')
  })
  it('冲突 → 追加 -1，保留扩展名', () => {
    expect(uniqueName('a.png', new Set(['a.png']))).toBe('a-1.png')
  })
  it('连续冲突 → 递增避开现有 + 本批', () => {
    expect(uniqueName('a.png', new Set(['a.png', 'a-1.png', 'a-2.png']))).toBe('a-3.png')
  })
  it('带目录前缀时前缀保留', () => {
    expect(uniqueName('ch/a.png', new Set(['ch/a.png']))).toBe('ch/a-1.png')
  })
  it('无扩展名文件', () => {
    expect(uniqueName('README', new Set(['README']))).toBe('README-1')
  })
})

describe('MEDIA_EXTS', () => {
  it('含常见图片与音频扩展名', () => {
    expect(MEDIA_EXTS).toEqual(expect.arrayContaining(['png', 'jpg', 'webp', 'mp3', 'ogg', 'wav']))
  })
})
