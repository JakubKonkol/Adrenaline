import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Download, Pause, XCircle } from 'lucide-react';
import type { DerivedJobStatus } from '@shared/domain/job-status';
import { t } from '../../i18n/t';
import styles from './Downloads.module.css';

const ICONS = {
  ready: CheckCircle2,
  error: XCircle,
  paused: Pause,
  attention: AlertTriangle,
  wait: Clock,
  busy: CircleDashed,
  download: Download,
} as const;

/** Status as text + icon (not color only, NFR08). */
export function StatusBadge({ status }: { status: DerivedJobStatus }) {
  const k = status.kind;
  const [icon, tone] =
    k === 'ready'
      ? (['ready', 'ok'] as const)
      : k === 'error'
        ? (['error', 'bad'] as const)
        : k === 'ready_subtitles_attention' ||
            k === 'paused_disk_full' ||
            k === 'paused_disk_missing' ||
            k === 'awaiting_selection'
          ? (['attention', 'warn'] as const)
          : k === 'paused'
            ? (['paused', 'muted'] as const)
            : k === 'queued' || k === 'engine_restarting'
              ? (['wait', 'muted'] as const)
              : k === 'downloading'
                ? (['download', 'info'] as const)
                : (['busy', 'info'] as const);
  const Icon = ICONS[icon];
  return (
    <span className={`${styles.badge} ${styles[tone]}`} data-testid="job-status" role="status">
      <Icon size={11} aria-hidden />
      {t(`downloads.status.${k}`)}
    </span>
  );
}
