import { type ButtonHTMLAttributes, forwardRef } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  const cls = [styles.button, styles[variant], size === 'sm' ? styles.sm : styles.md, className]
    .filter(Boolean)
    .join(' ');
  return <button ref={ref} type={type} className={cls} {...rest} />;
});
