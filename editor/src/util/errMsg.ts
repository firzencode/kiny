/** 取异常的可读信息（用于「<动作>失败：<具体>」通知）。 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
