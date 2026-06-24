/** Kiny 主页（导出网页底部署名指向此处）。 */
export const KINY_SITE_URL = 'https://firzencode.github.io/kiny-website/'

/** 首屏门：点击「开始阅读」既进入故事、又在该用户手势内解锁音频自动播放。 */
export function StartGate({ title, onStart }: { title: string; onStart: () => void }) {
  return (
    <div className="start-gate">
      <h1 className="start-title">{title}</h1>
      <button className="start-button" onClick={onStart}>开始阅读</button>
      <a className="start-credit" href={KINY_SITE_URL} target="_blank" rel="noreferrer noopener">
        Made with Kiny
      </a>
    </div>
  )
}
