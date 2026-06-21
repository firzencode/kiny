/** 静音开关：右上小控件。 */
export function AudioToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button className="audio-toggle" onClick={onToggle} aria-label={muted ? '取消静音' : '静音'}>
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
