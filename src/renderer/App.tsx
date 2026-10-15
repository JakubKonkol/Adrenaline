import { useEffect, useState } from 'react';
import markDark from './assets/brand/adrenaline-mark-on-dark.svg';
import markLight from './assets/brand/adrenaline-mark-on-light.svg';
import { TitleBar } from './components/TitleBar';
import { api, unwrap } from './api/bridge';
import { t } from './i18n/t';
import styles from './App.module.css';

export function App() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void unwrap(api().app.version()).then(setVersion);
  }, []);

  return (
    <div className={styles.shell}>
      <TitleBar />
      <main className={styles.content}>
        <div className={styles.hero}>
          <picture>
            <source srcSet={markLight} media="(prefers-color-scheme: light)" />
            <img className={styles.logo} src={markDark} alt="" aria-hidden />
          </picture>
          <h1 className={styles.title}>{t('home.title')}</h1>
          <p className={styles.subtitle}>{t('home.subtitle')}</p>
          <p className="label" data-testid="app-version">
            {version ? t('app.version', { version }) : t('app.loading')}
          </p>
        </div>
      </main>
    </div>
  );
}
