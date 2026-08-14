/**
 * 全屏背景图层：B 布局里作淡淡氛围底图（模糊+压暗由 styles.css 的 .bg-layer 负责）。
 *
 * 遮罩（`--kiny-bg-overlay`）是**底图的**色罩，故与底图同生共死、且**另起一层**：
 * - 只在有底图时渲染——没有底图时页面底色就是 `--kiny-page-bg` 的字面值，中间不隔任何东西。
 * - 不放进 `.bg-layer` 内（哪怕作伪元素）——那一层带 `filter: brightness()`，而 CSS filter
 *   连伪元素一起作用，遮罩会被连带压暗，作者写的 token 值就不等于实际罩色。
 */
export function BackgroundLayer({ src }: { src: string | null }) {
  return (
    <>
      <div
        data-testid="bg-layer"
        className="bg-layer"
        style={src ? { backgroundImage: `url("${src}")` } : undefined}
      />
      {src ? <div data-testid="bg-overlay" className="bg-overlay" /> : null}
    </>
  )
}
