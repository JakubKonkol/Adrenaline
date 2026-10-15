import logo from '../assets/brand/tmdb.svg';
import { t } from '../i18n/t';
import styles from './TmdbAttribution.module.css';

export function TmdbAttribution() {
  return (
    <footer className={styles.attribution}>
      <img src={logo} alt={t('catalog.tmdb')} />
      <p>{t('catalog.attribution')}</p>
    </footer>
  );
}
