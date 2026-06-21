import { useEffect } from 'react'
import type { Diagnostic, ValidatedProgram } from '@kiny/engine'

export interface ValidationOutcome {
  runId: number
  diagnostics: Diagnostic[]
  program: ValidatedProgram | null
}

/**
 * 防抖校验（spec §5）。runId 变化后等 delay 毫秒（作者停手）才调 run(runId)，
 * 把结果交给 onResult；消费者据 runId 丢弃过期结果（reducer 的 runId 守卫）。
 * run 应是稳定 identity 的回调（useCallback 读 ref），内部读当前全部缓冲跑 validateProject。
 */
export function useDebouncedValidation(
  runId: number,
  run: (runId: number) => ValidationOutcome,
  onResult: (r: ValidationOutcome) => void,
  delay = 300,
): void {
  useEffect(() => {
    const handle = setTimeout(() => onResult(run(runId)), delay)
    return () => clearTimeout(handle)
  }, [runId, run, onResult, delay])
}
