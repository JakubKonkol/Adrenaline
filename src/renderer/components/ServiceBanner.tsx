import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEngineStatus, useRestartEngine } from '../api/engine';
import { errorTexts } from '../i18n/errors';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import styles from './ServiceBanner.module.css';

/** Global bar for services that stopped working (engine now; TMDB/sources later). */
export function ServiceBanner() {
  const { data: engine } = useEngineStatus();
  const restart = useRestartEngine();
  if (engine?.state === 'restarting') {
    return (
      <div className={`${styles.bar} ${styles.info}`} role="status" data-testid="service-banner">
        <RefreshCw size={14} aria-hidden className={styles.spin} />
        <span>{t('engine.state.restarting')}</span>
      </div>
    );
  }
  if (engine?.state !== 'crashed' && engine?.state !== 'unavailable') return null;
  const code =
    engine.message === 'ENGINE_PROTOCOL_MISMATCH'
      ? 'ENGINE_PROTOCOL_MISMATCH'
      : engine.state === 'crashed'
        ? 'ENGINE_CRASHED'
        : 'ENGINE_UNAVAILABLE';
  return (
    <div className={`${styles.bar} ${styles.danger}`} role="alert" data-testid="service-banner">
      <AlertTriangle size={14} aria-hidden />
      <span className={styles.text}>
        {errorTexts[code].message} {errorTexts[code].action}
      </span>
      {engine.state === 'crashed' ? (
        <Button size="sm" disabled={restart.isPending} onClick={() => restart.mutate()}>
          {t('engine.restart')}
        </Button>
      ) : null}
    </div>
  );
}
