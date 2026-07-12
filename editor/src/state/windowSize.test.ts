import { describe, it, expect, beforeEach } from 'vitest'
import { isValidWorkbenchSize, loadWorkbenchSize, saveWorkbenchSize, computeLaunchSize, WORKBENCH_MIN_SIZE } from './windowSize'

const KEY = 'kiny-editor-window'

describe('windowSize 尺寸持久化守卫', () => {
  beforeEach(() => localStorage.clear())

  describe('isValidWorkbenchSize', () => {
    it('最小化 0×0 → 非法', () => {
      expect(isValidWorkbenchSize(0, 0)).toBe(false)
    })
    it('低于窗口最小值 → 非法', () => {
      expect(isValidWorkbenchSize(WORKBENCH_MIN_SIZE.width - 1, WORKBENCH_MIN_SIZE.height)).toBe(false)
      expect(isValidWorkbenchSize(WORKBENCH_MIN_SIZE.width, WORKBENCH_MIN_SIZE.height - 1)).toBe(false)
    })
    it('负数 / NaN / Infinity → 非法', () => {
      expect(isValidWorkbenchSize(-1, -1)).toBe(false)
      expect(isValidWorkbenchSize(NaN, 900)).toBe(false)
      expect(isValidWorkbenchSize(1440, Infinity)).toBe(false)
    })
    it('恰好等于最小值 / 更大 → 合法', () => {
      expect(isValidWorkbenchSize(WORKBENCH_MIN_SIZE.width, WORKBENCH_MIN_SIZE.height)).toBe(true)
      expect(isValidWorkbenchSize(1440, 900)).toBe(true)
    })
  })

  describe('saveWorkbenchSize', () => {
    it('退化尺寸（最小化 0×0）不写入', () => {
      saveWorkbenchSize(0, 0)
      expect(localStorage.getItem(KEY)).toBeNull()
    })
    it('合法尺寸正常写入', () => {
      saveWorkbenchSize(1440, 900)
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ width: 1440, height: 900 })
    })
    it('已有合法值时，后续 0×0 不覆盖', () => {
      saveWorkbenchSize(1200, 800)
      saveWorkbenchSize(0, 0) // 最小化事件
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ width: 1200, height: 800 })
    })
  })

  describe('loadWorkbenchSize', () => {
    it('无记录 → null', () => {
      expect(loadWorkbenchSize()).toBeNull()
    })
    it('存了退化 0×0（历史坏数据）→ null，走默认', () => {
      localStorage.setItem(KEY, JSON.stringify({ width: 0, height: 0 }))
      expect(loadWorkbenchSize()).toBeNull()
    })
    it('坏 JSON → null', () => {
      localStorage.setItem(KEY, '{not json')
      expect(loadWorkbenchSize()).toBeNull()
    })
    it('合法值 → 原样返回', () => {
      localStorage.setItem(KEY, JSON.stringify({ width: 1440, height: 900 }))
      expect(loadWorkbenchSize()).toEqual({ width: 1440, height: 900 })
    })
  })

  describe('computeLaunchSize（按屏幕分辨率算启动窗尺寸，夹到 [760×560, 1040×800]）', () => {
    it('1080p：约屏宽一半、屏高六成', () => {
      expect(computeLaunchSize({ width: 1920, height: 1080 })).toEqual({ width: 998, height: 691 })
    })
    it('小屏（1366×768）夹到下限附近，不小于 760×560', () => {
      const s = computeLaunchSize({ width: 1366, height: 768 })
      expect(s.width).toBeGreaterThanOrEqual(760)
      expect(s.height).toBeGreaterThanOrEqual(560)
      expect(s).toEqual({ width: 760, height: 560 }) // 0.52*1366=710→夹到 760；0.64*768=492→夹到 560
    })
    it('大屏（2560×1440）夹到上限 1040×800，不无限铺开', () => {
      expect(computeLaunchSize({ width: 2560, height: 1440 })).toEqual({ width: 1040, height: 800 })
    })
  })
})
