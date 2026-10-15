import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import styles from './Form.module.css';

/** Label + control + hint/error, wired with aria-describedby (NFR08). */
export function Field({
  label,
  hint,
  error,
  children,
  inline,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  inline?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`${styles.field} ${inline ? styles.inline : ''}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.control}>
        {children({
          id,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(error ? { 'aria-invalid': true } : {}),
        })}
        {hint ? (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${styles.input} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${styles.input} ${styles.select} ${props.className ?? ''}`} />;
}

/** Accessible switch (button with role="switch"). */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <span id={`${id}-label`} className={styles.toggleLabel}>
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className={styles.hint}>
            {description}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        {...(description ? { 'aria-describedby': `${id}-desc` } : {})}
        data-testid={testId}
        className={`${styles.switch} ${checked ? styles.on : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden />
      </button>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={styles.section} data-testid={testId}>
      <header className={styles.sectionHeader}>
        <h2 className="label">{title}</h2>
        {description ? <p className={styles.hint}>{description}</p> : null}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
