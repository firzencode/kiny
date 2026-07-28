/** Kiny 主页（署名外链指向此处）。shelf 自持一份（与 viewer 各持一份，不跨包）。 */
export const KINY_SITE_URL = 'https://www.ahayoo.com/kiny/'

/** 书架底部「Made with Kiny」署名——指向 Kiny 项目主页。 */
export function Credit() {
  return (
    <footer className="credit">
      <a href={KINY_SITE_URL} target="_blank" rel="noreferrer noopener">Made with Kiny</a>
    </footer>
  )
}
