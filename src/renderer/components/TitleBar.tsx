import iconSmall from '../assets/brand/adrenaline-icon-small.svg';
import { t } from '../i18n/t';
import styles from './TitleBar.module.css';

/** Custom 36 px title bar (as in Oxytocin): the whole bar drags the window; controls must use `no-drag`. */
export function TitleBar({ title }: { title?: string }) {
  return (
    <header className={`${styles.bar} drag`} data-testid="titlebar">
      <div className={styles.brand}>
        <img src={iconSmall} alt="" aria-hidden width={16} height={16} draggable={false} />
        <span className={styles.name}>{t('app.name')}</span>
      </div>
      {title ? <div className={styles.title}>{title}</div> : null}
    </header>
  );
}
