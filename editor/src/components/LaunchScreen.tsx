import bannerNight from '../assets/launch-night.jpg'
import bannerLight from '../assets/launch-light.jpg'

export interface RecentProject {
  dir: string
  name: string
  ts: number
}

export interface LaunchScreenProps {
  theme: 'dark' | 'light'
  recent: RecentProject[]
  onNewProject: () => void
  onOpenProject: () => void
  onOpenRecent: (dir: string) => void
  onRemoveRecent: (project: RecentProject) => void
}

/** 时间戳 → 相对时间（刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前）。 */
export function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  return `${day} 天前`
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden={true}>
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const OpenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden={true}>
    <path d="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  </svg>
)
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden={true}>
    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
  </svg>
)

/**
 * 编辑器启动页：冷启动 / 关闭项目后展示，替代「无项目空状态」。
 * 上方 banner 图（随主题切换）+ 下方操作区（新建 / 打开 + 最近项目）。
 */
export function LaunchScreen({ theme, recent, onNewProject, onOpenProject, onOpenRecent, onRemoveRecent }: LaunchScreenProps) {
  const now = Date.now()
  const banner = theme === 'light' ? bannerLight : bannerNight
  return (
    <div className="launch">
      <div className="launch-win">
        <div className="launch-banner">
          <img src={banner} alt="Kiny" />
        </div>
        <div className="launch-dock">
          <div className="launch-actions">
            <button className="launch-act primary" onClick={onNewProject}>
              <span className="launch-act-ic"><PlusIcon /></span>
              <span className="launch-act-lb">
                <span className="t">新建项目</span>
                <span className="s">从空白故事开始</span>
              </span>
            </button>
            <button className="launch-act ghost" onClick={onOpenProject}>
              <span className="launch-act-ic"><OpenIcon /></span>
              <span className="launch-act-lb">
                <span className="t">打开项目</span>
                <span className="s">选择 .kiw 文件</span>
              </span>
            </button>
          </div>
          <div className="launch-recent">
            <div className="launch-recent-head">
              <span className="lab">最近项目</span>
              {recent.length > 0 && <span className="cnt">{recent.length}</span>}
            </div>
            {recent.length === 0 ? (
              <p className="launch-recent-empty">还没有项目，点上方「新建项目」开始。</p>
            ) : (
              <ul className="launch-recent-list">
                {recent.map((r) => (
                  <li key={r.dir}>
                    <div className="launch-recent-row">
                      <button className="launch-recent-item" onClick={() => onOpenRecent(r.dir)}>
                        <span className="thumb">{[...r.name][0] ?? '·'}</span>
                        <span className="meta">
                          <span className="nm">{r.name}</span>
                          <span className="pt">{r.dir}</span>
                        </span>
                        <span className="when">{formatRelative(r.ts, now)}</span>
                      </button>
                      <button
                        className="launch-recent-del"
                        aria-label={`从最近项目移除 ${r.name}`}
                        onClick={() => onRemoveRecent(r)}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
