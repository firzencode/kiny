/** 全屏背景图层：B 布局里作淡淡氛围底图（模糊+压暗由 styles.css 的 .bg-layer 负责）。 */
export function BackgroundLayer({ src }: { src: string | null }) {
  return (
    <div
      data-testid="bg-layer"
      className="bg-layer"
      style={src ? { backgroundImage: `url("${src}")` } : undefined}
    />
  )
}
