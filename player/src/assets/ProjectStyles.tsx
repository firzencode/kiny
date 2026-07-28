/**
 * 作品前端资源的注入点：把 `buildProjectCss` 编译出的那段 css 渲染成一个 `<style>`。
 * 空串不渲染（无资源的项目零副作用）。
 *
 * 幂等：css 是项目文件的纯函数，restore / replay / 编辑重算产出同一文本，React 协调复用同一个
 * style 元素——不会重复注入、不会闪白。宿主要临时停用作品主题（editor 预览的「应用作品主题」
 * 开关）只需不渲染本组件。
 */
export function ProjectStyles({ css }: { css: string }) {
  if (css === '') return null
  return <style data-kiny-project-styles="">{css}</style>
}
