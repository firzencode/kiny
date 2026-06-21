import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageSample } from './stage-sample.mjs'

test('stageSample 拷贝目录并按需生成 files.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage-'))
  try {
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    mkdirSync(join(src, 'assets'), { recursive: true })
    writeFileSync(join(src, 'main.kin'), 'hello\n')
    writeFileSync(join(src, 'kiny.json'), '{}\n')
    writeFileSync(join(src, 'assets', 'a.jpg'), 'binary')

    stageSample(src, dest, { filesJson: true })

    assert.equal(readFileSync(join(dest, 'main.kin'), 'utf8'), 'hello\n')
    assert.ok(existsSync(join(dest, 'assets', 'a.jpg')))
    assert.deepEqual(JSON.parse(readFileSync(join(dest, 'files.json'), 'utf8')), ['main.kin'])
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
