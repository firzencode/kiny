/** 首屏门：点击「开始阅读」既进入故事、又在该用户手势内解锁音频自动播放。 */
export function StartGate({ title, onStart }: { title: string; onStart: () => void }) {
  return (
    <div className="start-gate">
      <h1 className="start-title">{title}</h1>
      <button className="start-button" onClick={onStart}>开始阅读</button>
    </div>
  )
}
