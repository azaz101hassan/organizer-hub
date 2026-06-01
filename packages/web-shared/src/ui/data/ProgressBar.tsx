export interface ProgressBarProps {
  valueCents: number;
  targetCents: number;
  label: string;
}

export function ProgressBar({ valueCents, targetCents, label }: ProgressBarProps) {
  const safeValue = Number.isFinite(valueCents) ? valueCents : 0;
  const safeTarget =
    Number.isFinite(targetCents) && targetCents > 0 ? targetCents : 0;
  const ratio =
    safeTarget === 0 ? 0 : Math.min(1, Math.max(0, safeValue / safeTarget));
  const pct = Math.round(ratio * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span data-testid="progress-fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
