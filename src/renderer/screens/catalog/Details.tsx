import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { mediaTypeSchema, tmdbIdSchema } from '@shared/contracts/catalog';
import { useCatalogSelection, useTitle } from '../../api/catalog';
import { ApiError } from '../../api/bridge';
import { TmdbAttribution } from '../../components/TmdbAttribution';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { Page } from '../../ui/Page';
import { CatalogError } from './CatalogError';
import { Poster } from './Poster';
import styles from './Catalog.module.css';

export function Details() {
  const params = useParams();
  const location = useLocation();
  const previousSearch = (location.state as { search?: unknown } | null)?.search;
  const backTo = typeof previousSearch === 'string' && previousSearch.startsWith('/?') ? previousSearch : '/';
  const parsedType = mediaTypeSchema.safeParse(params['type']);
  const id = Number(params['id']);
  const valid = parsedType.success && tmdbIdSchema.safeParse(id).success;
  const details = useTitle(parsedType.success ? parsedType.data : 'movie', id, valid);
  const select = useCatalogSelection();
  const navigate = useNavigate();
  const title = details.data;
  return (
    <Page
      title={title?.title ?? t('nav.search')}
      label={title ? t(`catalog.${title.type}`) : t('nav.search')}
      testId="screen-title"
    >
      <Link to={backTo}>{t('catalog.backToSearch')}</Link>
      {!valid ? (
        <CatalogError error={new ApiError({ code: 'BAD_REQUEST', message: '' })} />
      ) : details.error ? (
        <CatalogError error={details.error} retry={() => void details.refetch()} />
      ) : !title ? (
        <p role="status">{t('app.loading')}</p>
      ) : (
        <>
          <div className={styles.details}>
            <Poster path={title.posterPath} size="w342" />
            <div className={styles.description}>
              {title.originalTitle !== title.title ? <p className={styles.original}>{title.originalTitle}</p> : null}
              <p className="label">
                {title.year ?? t('catalog.unknownYear')}
                {title.runtime ? ` · ${t('catalog.runtime', { minutes: title.runtime })}` : ''}
              </p>
              <p className={styles.muted}>{title.genres.join(' · ')}</p>
              <p className={styles.overview}>{title.overview || t('catalog.noOverview')}</p>
              {title.type === 'movie' ? (
                <Button
                  variant="primary"
                  disabled={select.isPending}
                  onClick={() =>
                    select.mutate(
                      { type: 'movie', tmdbId: title.tmdbId },
                      { onSuccess: (target) => void navigate('/releases', { state: { target } }) },
                    )
                  }
                >
                  {t(select.isPending ? 'catalog.selecting' : 'catalog.searchReleases')}
                </Button>
              ) : null}
              {select.error ? <CatalogError error={select.error} /> : null}
            </div>
          </div>
          {title.type === 'tv' ? (
            <section>
              <h2>{t('catalog.seasons')}</h2>
              <ul className={styles.seasons}>
                {title.seasons.map((season) => (
                  <li key={season.number}>
                    <Link to={`/title/tv/${id}/season/${season.number}`} state={{ search: backTo }}>
                      <span>
                        {t('catalog.season', { number: season.number })} · {season.name}
                      </span>
                      <span className={styles.muted}>{t('catalog.episodeCount', { count: season.episodeCount })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {!title.seasons.length ? <p>{t('catalog.noSeasons')}</p> : null}
            </section>
          ) : null}
        </>
      )}
      <TmdbAttribution />
    </Page>
  );
}
