import { ArrowDownToLine } from 'lucide-react';
import { useInstallUpdate, useUpdaterStatus } from '../api/updater';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import styles from './UpdateBanner.module.css';

/** Shown when an update has been downloaded (D-76): "Uruchom ponownie, aby zaktualizować". */
export function UpdateBanner() {
  const { data: status } = useUpdaterStatus();
  const install = useInstallUpdate();
  if (status?.state !== 'ready') return null;
  return (
    <div className={styles.banner} role="status" data-testid="update-banner">
      <ArrowDownToLine size={14} aria-hidden className={styles.icon} />
      <span className={styles.text}>{t('updater.bannerReady', { version: status.version ?? '' })}</span>
      <Button variant="primary" size="sm" disabled={install.isPending} onClick={() => install.mutate()}>
        {t('updater.restart')}
      </Button>
    </div>
  );
}
