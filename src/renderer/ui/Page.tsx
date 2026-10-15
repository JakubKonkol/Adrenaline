import type { ReactNode } from 'react';
import styles from './Page.module.css';

/** Standard screen frame: mono section label, title, optional actions, scrollable body. */
export function Page({
  label,
  title,
  actions,
  children,
  testId,
}: {
  label?: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={styles.page} data-testid={testId}>
      <header className={styles.header}>
        <div className={styles.heading}>
          {label ? <span className="label">{label}</span> : null}
          <h1 className={styles.title}>{title}</h1>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.card} ${className ?? ''}`}>{children}</div>;
}
