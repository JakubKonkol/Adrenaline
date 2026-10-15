import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { seasonNumberSchema, tmdbIdSchema } from '@shared/contracts/catalog';
import { ApiError } from '../../api/bridge';
import { useCatalogSelection, useSeason, useTitle } from '../../api/catalog';
import { TmdbAttribution } from '../../components/TmdbAttribution';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { Page } from '../../ui/Page';
import { CatalogError } from './CatalogError';
import styles from './Catalog.module.css';

export function Season() {
  const params = useParams();
  const location = useLocation();
  const id = Number(params['id']);
  const number = Number(params['n']);
  const valid = tmdbIdSchema.safeParse(id).success && seasonNumberSchema.safeParse(number).success;
  const details = useTitle('tv', id, valid);
  const season = useSeason(id, number, valid);
  const select = useCatalogSelection();
  const navigate = useNavigate();
  return (
    <Page
      title={details.data?.title ?? t('catalog.series')}
      label={t('catalog.season', { number })}
      testId="screen-season"
    >
      <Link to={`/title/tv/${id}`} state={location.state as unknown}>
        {t('common.back')}
      </Link>
      {!valid ? (
        <CatalogError error={new ApiError({ code: 'BAD_REQUEST', message: '' })} />
      ) : season.error || details.error ? (
        <CatalogError
          error={season.error ?? details.error}
          retry={() => {
            void season.refetch();
            void details.refetch();
          }}
        />
      ) : !season.data || !details.data ? (
        <p role="status">{t('app.loading')}</p>
      ) : (
        <>
          <h2>{season.data.name}</h2>
          {select.error ? <CatalogError error={select.error} /> : null}
          <ol className={styles.episodes}>
            {season.data.episodes.map((episode) => (
              <li key={episode.tmdbId}>
                <div>
                  <span className="label">{t('catalog.episode', { number: episode.number })}</span>
                  <h3>{episode.title}</h3>
                  <p className={styles.muted}>
                    {episode.airDate
                      ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC' }).format(new Date(episode.airDate))
                      : t('catalog.noAirDate')}
                  </p>
                  {episode.overview ? <p>{episode.overview}</p> : null}
                </div>
                <Button
                  disabled={select.isPending}
                  onClick={() =>
                    select.mutate(
                      { type: 'tv', tmdbId: id, season: number, episode: episode.number },
                      { onSuccess: (target) => void navigate('/releases', { state: { target } }) },
                    )
                  }
                >
                  {t('catalog.searchReleases')}
                </Button>
              </li>
            ))}
          </ol>
          {!season.data.episodes.length ? <p>{t('catalog.noEpisodes')}</p> : null}
        </>
      )}
      <TmdbAttribution />
    </Page>
  );
}
