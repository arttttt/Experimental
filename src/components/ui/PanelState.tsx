type PanelStateTone = 'neutral' | 'danger';

interface PanelStateMessageProps {
  title: string;
  description: string;
  tone?: PanelStateTone;
  actionLabel?: string;
  onAction?: () => void;
}

interface PanelSkeletonProps {
  rows?: number;
}

function toneClasses(tone: PanelStateTone): string {
  if (tone === 'danger') {
    return 'border-red-500/40 bg-red-500/10 text-red-100';
  }

  return 'border-slate-700/80 bg-slate-900/70 text-slate-100';
}

function toneDescriptionClasses(tone: PanelStateTone): string {
  if (tone === 'danger') {
    return 'text-red-200';
  }

  return 'text-slate-300';
}

export function PanelStateMessage({
  title,
  description,
  tone = 'neutral',
  actionLabel,
  onAction,
}: PanelStateMessageProps) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${toneClasses(tone)}`}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className={`mt-1 text-xs ${toneDescriptionClasses(tone)}`}>{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function PanelSkeleton({ rows = 3 }: PanelSkeletonProps) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-9 rounded-md border border-slate-800/80 bg-gradient-to-r from-slate-900 via-slate-800/80 to-slate-900"
        />
      ))}
    </div>
  );
}
