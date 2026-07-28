import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageSample } from './stage-sample.mjs'

test('stageSample 拷贝目录并生成 files.json（manifest 在前 + 递归全部文件）', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'))
  try {
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    mkdirSync(join(src, 'assets'), { recursive: true })
    mkdirSync(join(src, 'theme'), { recursive: true })
    writeFileSync(join(src, 'main.kin'), 'hello\n')
    writeFileSync(join(src, '雾港之夜.kiw'), '{}\n')
    writeFileSync(join(src, 'assets', 'a.jpg'), 'binary')
    writeFileSync(join(src, 'theme', 'skin.css'), '.player{}\n')

    stageSample(src, dest, { filesJson: true })

    assert.equal(readFileSync(join(dest, 'main.kin'), 'utf8'), 'hello\n')
    assert.ok(existsSync(join(dest, 'assets', 'a.jpg')))
    // files.json 索引：manifest 在前，其余为**全部**项目文件（含子目录资源）——
    // viewer 据此挑 .kin 作故事文件、.css 与字体作前端资源，图片音频按需引用。
    assert.deepEqual(JSON.parse(readFileSync(join(dest, 'files.json'), 'utf8')), [
      '雾港之夜.kiw', 'assets/a.jpg', 'main.kin', 'theme/skin.css',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stageSample 生成 files.json：跳过 . 开头路径段与 node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'))
  try {
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    mkdirSync(join(src, '.git'), { recursive: true })
    mkdirSync(join(src, 'node_modules'), { recursive: true })
    writeFileSync(join(src, 'kiny.json'), '{}\n')
    writeFileSync(join(src, 'main.kin'), 'x\n')
    writeFileSync(join(src, '.git', 'HEAD'), 'ref\n')
    writeFileSync(join(src, 'node_modules', 'p.css'), 'a{}\n')
    writeFileSync(join(src, '.hidden.css'), 'a{}\n')

    stageSample(src, dest, { filesJson: true })

    assert.deepEqual(JSON.parse(readFileSync(join(dest, 'files.json'), 'utf8')), ['kiny.json', 'main.kin'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stageSample 生成 files.json：旧 kiny.json 项目 fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'))
  try {
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'main.kin'), 'hello\n')
    writeFileSync(join(src, 'kiny.json'), '{}\n')

    stageSample(src, dest, { filesJson: true })

    assert.deepEqual(JSON.parse(readFileSync(join(dest, 'files.json'), 'utf8')), ['kiny.json', 'main.kin'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stageSample 不传 filesJson 时不生成索引', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'))
  try {
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'main.kin'), 'x\n')
    stageSample(src, dest)
    assert.ok(!existsSync(join(dest, 'files.json')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stageSample 清空旧目标，不残留陈旧文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'))
  try {
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'main.kin'), 'x\n')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'stale.txt'), 'old')
    stageSample(src, dest)
    assert.ok(!existsSync(join(dest, 'stale.txt')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
