import { Link, useLocation } from 'react-router';
import { searchTargetSchema } from '@shared/domain/search-target';
import { t } from '../../i18n/t';
import { Card, Page } from '../../ui/Page';

/** Stage 5 replaces the empty state; stage 4 passes a validated, persisted SearchTarget. */
export function Releases() {
  const location = useLocation();
  const parsed = searchTargetSchema.safeParse((location.state as { target?: unknown } | null)?.target);
  const target = parsed.success ? parsed.data : null;
  return (
    <Page title={target?.title ?? t('catalog.releases')} label={t('catalog.releases')} testId="screen-releases">
      <Link to={target ? `/title/${target.kind === 'movie' ? 'movie' : 'tv'}/${target.tmdbId}` : '/'}>
        {t('common.back')}
      </Link>
      <Card>
        {target ? (
          <>
            <p>
              {target.originalTitle} · {target.year ?? t('catalog.unknownYear')}
            </p>
            {target.kind === 'episode' ? (
              <p>{t('catalog.selectedEpisode', { season: target.season, episode: target.episode })}</p>
            ) : null}
            <p>{t('catalog.releasesPending')}</p>
          </>
        ) : (
          <p>{t('catalog.invalidTarget')}</p>
        )}
      </Card>
    </Page>
  );
}
