import type { FileStats, ProjectStats } from '../stats/countStats'

/**
 * 底部状态栏：当前文件字数 + 项目汇总。纯展示；悬停 title 给明细。
 */
export function StatusBar({ file, project }: { file: FileStats | null; project: ProjectStats | null }) {
  if (project === null) return null
  const fmt = (n: number) => n.toLocaleString('zh-CN')
  return (
    <div className="status-bar" aria-label="字数统计">
      {file !== null && (
        <span className="status-item" title={`当前文件：${file.knots} 节点 / ${file.stitches} 子节点 / ${file.choices} 选项 / ${file.commands} 命令 / ${file.lines} 行`}>
          当前文件 正文 <b>{fmt(file.textChars)}</b> 字 · 总 <b>{fmt(file.totalChars)}</b> 字符
        </span>
      )}
      <span
        className="status-item"
        title={`项目：${project.files.length} 个文本文件 / ${project.knots} 节点 / ${project.stitches} 子节点 / ${project.choices} 选项 / ${project.lines} 行`}
      >
        项目 正文 <b>{fmt(project.textChars)}</b> 字 · 总 <b>{fmt(project.totalChars)}</b> 字符
      </span>
    </div>
  )
}
