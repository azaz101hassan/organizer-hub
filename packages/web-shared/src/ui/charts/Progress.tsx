export interface ProgressProps {
  /** Value between 0 and 100 */
  value: number;
  /** Optional accessible label */
  label?: string;
}

export function Progress({ value, label }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
