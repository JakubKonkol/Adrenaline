import styles from './ProgressBar.module.css';

/** Accessible progress bar (value as text for screen readers). */
export function ProgressBar({
  value,
  label,
  tone = 'accent',
  stale,
}: {
  value: number | null;
  label: string;
  tone?: 'accent' | 'success' | 'warning' | 'muted';
  stale?: boolean;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className={`${styles.track} ${stale ? styles.stale : ''}`}
      role="progressbar"
      aria-live="polite"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(value === null ? {} : { 'aria-valuenow': Math.round(pct) })}
    >
      <div className={`${styles.fill} ${styles[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
