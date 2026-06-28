#!/usr/bin/env node
// 构建期把 Kin 语言规范拷进 editor 树作 ?raw 资产（editor pre{dev,build,test} 钩子调）。
// 详细查询的单一真相源是 docs/reference/kin_spec_draft.md；此处只暂存、不改写。
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/public/ → 仓库根 = 上两级（cwd 无关，按脚本自身位置解析）。
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = join(root, 'docs', 'reference', 'kin_spec_draft.md')
const destDir = join(root, 'editor', 'src', 'ai', 'generated')
const dest = join(destDir, 'kin-spec.md')

mkdirSync(destDir, { recursive: true })
cpSync(src, dest)
console.log(`已 stage Kin 规范: ${src} -> ${dest}`)
