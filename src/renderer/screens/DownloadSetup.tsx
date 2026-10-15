import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import { Card, Page } from '../ui/Page';

/** Stage 6 turns this into the download configuration (folder, subtitles, seeding, files). */
export function DownloadSetup() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { releaseName?: string } | null;
  return (
    <Page
      label={t('downloadSetup.title')}
      title={t('downloadSetup.title')}
      testId="screen-download-setup"
      actions={
        <Button variant="ghost" onClick={() => void navigate(-1)}>
          <ArrowLeft size={14} aria-hidden /> {t('common.back')}
        </Button>
      }
    >
      <Card>
        <p className="label">{t('downloadSetup.chosen')}</p>
        <p className="mono">{state?.releaseName ?? '—'}</p>
      </Card>
      <p>{t('downloadSetup.pending')}</p>
    </Page>
  );
}
