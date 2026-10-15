import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { isAppErrorCode } from '@shared/errors';
import { ApiError } from '../api/bridge';
import { errorTexts } from '../i18n/errors';
import styles from './ErrorNotice.module.css';

export function errorText(error: unknown): { message: string; action: string; code: string } {
  const code = error instanceof ApiError ? error.code : 'INTERNAL';
  const texts = isAppErrorCode(code) ? errorTexts[code] : errorTexts.INTERNAL;
  return { ...texts, code };
}

/** Error with its code, Polish message and suggested action (icon + text, not color only — NFR08). */
export function ErrorNotice({ error, actions, compact }: { error: unknown; actions?: ReactNode; compact?: boolean }) {
  const { message, action, code } = errorText(error);
  return (
    <div className={`${styles.notice} ${compact ? styles.compact : ''}`} role="alert" data-error-code={code}>
      <AlertTriangle size={16} aria-hidden className={styles.icon} />
      <div className={styles.text}>
        <p className={styles.message}>{message}</p>
        <p className={styles.action}>
          {action} <span className="mono">({code})</span>
        </p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
