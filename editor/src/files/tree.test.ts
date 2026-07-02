import { describe, it, expect } from 'vitest'
import { buildTree, collectDirs, moveTarget } from './tree'

describe('buildTree', () => {
  it('扁平文件 → 文件节点，按名升序', () => {
    const t = buildTree([{ path: 'b.kin', isKin: true }, { path: 'a.kin', isKin: true }], [])
    expect(t.map((n) => n.path)).toEqual(['a.kin', 'b.kin'])
    expect(t[0]).toMatchObject({ name: 'a.kin', kind: 'file', isKin: true })
  })

  it('子目录聚合成 dir 节点，文件夹排在文件前', () => {
    const t = buildTree(
      [{ path: 'main.kin', isKin: true }, { path: 'chapters/b.kin', isKin: true }, { path: 'chapters/a.kin', isKin: true }],
      [],
    )
    expect(t.map((n) => ({ name: n.name, kind: n.kind }))).toEqual([
      { name: 'chapters', kind: 'dir' },
      { name: 'main.kin', kind: 'file' },
    ])
    expect(t[0].children!.map((c) => c.path)).toEqual(['chapters/a.kin', 'chapters/b.kin'])
  })

  it('空目录也出现在树里', () => {
    const t = buildTree([], ['art'])
    expect(t).toEqual([{ name: 'art', path: 'art', kind: 'dir', children: [] }])
  })

  it('非 .kin 文件 isKin=false', () => {
    const t = buildTree([{ path: 'assets/x.jpg', isKin: false }], [])
    expect(t[0].children![0]).toMatchObject({ name: 'x.jpg', kind: 'file', isKin: false })
  })
})

describe('moveTarget', () => {
  it('普通移动到子目录', () => { expect(moveTarget('a.kin', 'chapters')).toBe('chapters/a.kin') })
  it('移动到根（toDir 空）', () => { expect(moveTarget('chapters/a.kin', '')).toBe('a.kin') })
  it('原位返回 null', () => { expect(moveTarget('chapters/a.kin', 'chapters')).toBeNull() })
  it('移入自身子树返回 null', () => { expect(moveTarget('ch', 'ch/sub')).toBeNull() })
  it('空源返回 null', () => { expect(moveTarget('', 'x')).toBeNull() })
})

describe('collectDirs', () => {
  it('递归收集全部目录并带层级深度，顺序沿用 tree（文件夹排前、同级升序）', () => {
    const tree = buildTree(
      [{ path: 'main.kin', isKin: true }, { path: 'ch/a.kin', isKin: true }, { path: 'ch/sub/b.kin', isKin: true }],
      ['art'],
    )
    expect(collectDirs(tree)).toEqual([
      { path: 'art', name: 'art', depth: 0 },
      { path: 'ch', name: 'ch', depth: 0 },
      { path: 'ch/sub', name: 'sub', depth: 1 },
    ])
  })

  it('无目录时返回空', () => {
    expect(collectDirs(buildTree([{ path: 'a.kin', isKin: true }], []))).toEqual([])
  })
})
