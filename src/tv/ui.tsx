import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { current, focus, focusFirst, register, update } from './focus';
import { t } from './i18n';
import { useBackHandler } from './nav';

interface FocusableProps {
  onSelect?: () => void;
  group?: string;
  /** Stable key: focus returns here when the user comes back to the screen. */
  focusKey?: string;
  autoFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  label?: string;
  disabled?: boolean;
  onFocus?: () => void;
  testId?: string;
}

/** Any element the remote can reach. Enter calls `onSelect`; a mouse click does the same (browser development). */
export function Focusable({
  onSelect,
  group,
  focusKey,
  autoFocus,
  className,
  style,
  children,
  label,
  disabled,
  onFocus,
  testId,
}: FocusableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const meta = { ...(onSelect && !disabled ? { onSelect } : {}), ...(group ? { group } : {}) };
  useLayoutEffect(() => {
    const el = ref.current;
    return el ? register(el, meta) : undefined;
    // Registration follows the element; the handlers are refreshed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (ref.current) update(ref.current, meta);
  });
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={onSelect ? 'button' : undefined}
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`focusable ${className ?? ''} ${disabled ? 'is-disabled' : ''}`}
      style={style}
      data-focus-key={focusKey}
      data-autofocus={autoFocus ? '' : undefined}
      data-testid={testId}
      onClick={disabled ? undefined : onSelect}
      onFocus={onFocus}
    >
      {children}
    </div>
  );
}

export function Button({ children, icon, primary, ...rest }: FocusableProps & { icon?: ReactNode; primary?: boolean }) {
  return (
    <Focusable {...rest} className={`btn ${primary ? 'btn-primary' : ''} ${rest.className ?? ''}`}>
      {icon ? <span className="btn-icon">{icon}</span> : null}
      <span>{children}</span>
    </Focusable>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <div className="spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function ProgressBar({ value }: { value: number | null }) {
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

/** Lazy image with a text fallback (missing poster, offline TMDB). */
export function Picture({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src)
    return (
      <div className={`picture-fallback ${className ?? ''}`}>
        <span>{alt}</span>
      </div>
    );
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />;
}

/** A titled horizontal row of cards (its own focus group). */
export function Row({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="row-section">
      <h2 className="row-title">{title}</h2>
      <div className="row" data-row={id}>
        {children}
      </div>
    </section>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useBackHandler(() => {
    onClose();
    return true;
  });
  useLayoutEffect(() => {
    // Focus moves into the dialog and goes back to the element that opened it.
    const opener = current();
    const dialog = ref.current;
    if (dialog) focusFirst(dialog);
    return () => {
      setTimeout(() => {
        if (!dialog?.isConnected && opener?.isConnected) focus(opener);
      }, 0);
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div className="modal" data-focus-trap="" ref={ref} role="dialog" aria-label={title}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Message({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="message">
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {action && onAction ? (
        <Button primary autoFocus onSelect={onAction} focusKey="message-action">
          {action}
        </Button>
      ) : null}
    </div>
  );
}

export function RetryMessage({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <Message title={text} action={t('app.retry')} onAction={onRetry} />;
}
