import { FolderOpen, RefreshCw } from 'lucide-react';
import type { UpdaterStatus } from '@shared/contracts/app';
import logoDark from '../assets/brand/adrenaline-logo-on-dark.svg';
import logoLight from '../assets/brand/adrenaline-logo-on-light.svg';
import { api } from '../api/bridge';
import { TmdbAttribution } from '../components/TmdbAttribution';
import { useEngineStatus, useRestartEngine } from '../api/engine';
import { useAppVersion, useCheckForUpdates, useUpdaterStatus } from '../api/updater';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import { Card, Page } from '../ui/Page';
import styles from './About.module.css';

export function updaterStatusText(s: UpdaterStatus | undefined): string {
  if (!s) return t('app.loading');
  switch (s.state) {
    case 'downloading':
      return s.version
        ? t('updater.state.downloadingVersion', { version: s.version, percent: Math.round(s.percent ?? 0) })
        : t('updater.state.downloading');
    case 'ready':
      return t('updater.state.ready', { version: s.version ?? '' });
    default:
      return t(`updater.state.${s.state}`);
  }
}

export function About() {
  const { data: version } = useAppVersion();
  const { data: status } = useUpdaterStatus();
  const check = useCheckForUpdates();
  const busy = check.isPending || status?.state === 'checking' || status?.state === 'downloading';
  const { data: engine } = useEngineStatus();
  const restartEngine = useRestartEngine();

  return (
    <Page label={t('nav.about')} title={t('about.title')} testId="screen-about">
      <Card className={styles.brandCard}>
        <picture>
          <source srcSet={logoLight} media="(prefers-color-scheme: light)" />
          <img className={styles.logo} src={logoDark} alt={t('app.name')} />
        </picture>
        <p className={styles.tagline}>{t('about.tagline')}</p>
      </Card>

      <Card>
        <dl className={styles.facts}>
          <dt className="label">{t('about.versionLabel')}</dt>
          <dd className="mono" data-testid="app-version">
            {version ?? t('app.loading')}
          </dd>

          <dt className="label">{t('about.updatesLabel')}</dt>
          <dd className={styles.row}>
            <span role="status" data-testid="updater-status">
              {updaterStatusText(status)}
            </span>
            {status?.state !== 'disabled' ? (
              <Button size="sm" disabled={busy} onClick={() => check.mutate()}>
                <RefreshCw size={12} aria-hidden />
                {t('updater.check')}
              </Button>
            ) : null}
          </dd>

          <dt className="label">{t('about.engineLabel')}</dt>
          <dd className={styles.stack} data-testid="engine-status">
            <span className={styles.row}>
              <span>{engine ? t(`engine.state.${engine.state}`) : t('app.loading')}</span>
              {engine?.state === 'crashed' ? (
                <Button size="sm" disabled={restartEngine.isPending} onClick={() => restartEngine.mutate()}>
                  {t('engine.restart')}
                </Button>
              ) : null}
            </span>
            {engine?.engineVersion ? (
              <span className={`mono ${styles.muted}`}>
                {engine.fake
                  ? t('engine.fake')
                  : t('engine.versions', { engine: engine.engineVersion, libtorrent: engine.libtorrent ?? '?' })}
              </span>
            ) : null}
          </dd>

          <dt className="label">{t('about.logsLabel')}</dt>
          <dd>
            <Button size="sm" onClick={() => void api().app.openLogsFolder()}>
              <FolderOpen size={12} aria-hidden />
              {t('about.openLogs')}
            </Button>
          </dd>
        </dl>
      </Card>

      <p className={styles.footer}>{t('about.author')}</p>
      <TmdbAttribution />
    </Page>
  );
}
