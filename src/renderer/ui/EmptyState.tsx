import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export function EmptyState({
  icon,
  title,
  body,
  action,
  testId,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={styles.empty} data-testid={testId}>
      {icon ? (
        <div className={styles.icon} aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className={styles.title}>{title}</p>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
