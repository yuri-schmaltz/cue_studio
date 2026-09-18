// The version badge used to live next to the wordmark here. The
// browser tab already carries the version via document.title
// (see <title>Maestro v2.0.1</title> + the system-config script in
// index.html), so duplicating it in the header is redundant noise.
// We keep the MaestroBrand API stable for callers that still import it.
export function MaestroBrand({
  compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}) {
  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`}>
      <img
        src="/cue-studio-icon-1254.png"
        alt=""
        className={`${compact ? 'h-7 w-7 rounded-[7px]' : 'h-8 w-8 rounded-lg'} shrink-0`}
      />
      {!compact && (
        <span className="text-sm font-semibold tracking-tight text-text-primary">Cue Studio</span>
      )}
    </div>
  )
}
