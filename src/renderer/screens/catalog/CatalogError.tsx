import { Link } from 'react-router';
import { ApiError } from '../../api/bridge';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';

export function CatalogError({ error, retry }: { error: unknown; retry?: () => void }) {
  const keyError = error instanceof ApiError && ['TMDB_NO_KEY', 'TMDB_UNAUTHORIZED'].includes(error.code);
  return (
    <ErrorNotice
      error={error}
      actions={
        keyError ? (
          <Link to="/settings">{t('catalog.settings')}</Link>
        ) : retry ? (
          <Button onClick={retry}>{t('catalog.retry')}</Button>
        ) : undefined
      }
    />
  );
}
