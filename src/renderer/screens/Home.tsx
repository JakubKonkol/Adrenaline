import markDark from '../assets/brand/adrenaline-mark-on-dark.svg';
import markLight from '../assets/brand/adrenaline-mark-on-light.svg';
import { t } from '../i18n/t';
import styles from './Home.module.css';

export function Home() {
  return (
    <div className={styles.home} data-testid="screen-home">
      <div className={styles.hero}>
        <picture>
          <source srcSet={markLight} media="(prefers-color-scheme: light)" />
          <img className={styles.logo} src={markDark} alt="" aria-hidden />
        </picture>
        <h1 className={styles.title}>{t('home.title')}</h1>
        <p className={styles.subtitle}>{t('home.subtitle')}</p>
      </div>
    </div>
  );
}
