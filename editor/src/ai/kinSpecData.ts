/**
 * 运行时载入构建期暂存的 Kin 规范资产并解析（spec §3.2）。
 * 本模块是**唯一**导入生成资产的地方；解析一次后缓存为模块级常量。
 */
import specMd from './generated/kin-spec.md?raw'
import { parseKinSpec, type ParsedSection } from './kinSpec'

/** 全部带编号章节（解析自语言规范正本）。 */
export const SPEC_SECTIONS: ParsedSection[] = parseKinSpec(specMd)
