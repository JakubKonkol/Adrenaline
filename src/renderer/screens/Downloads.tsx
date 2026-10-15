import { Download, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Page } from '../ui/Page';

export function Downloads() {
  const navigate = useNavigate();
  return (
    <Page label={t('nav.downloads')} title={t('downloads.title')} testId="screen-downloads">
      <EmptyState
        icon={<Download size={20} />}
        title={t('downloads.emptyTitle')}
        body={t('downloads.emptyBody')}
        action={
          <Button variant="primary" onClick={() => void navigate('/')}>
            <Search size={14} aria-hidden />
            {t('downloads.emptyAction')}
          </Button>
        }
      />
    </Page>
  );
}
