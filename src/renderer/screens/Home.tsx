import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import type { MediaType } from '@shared/contracts/catalog';
import { useCatalogSearch } from '../api/catalog';
import { ApiError } from '../api/bridge';
import { useSecretsStatus } from '../api/settings';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Form';
import { Page } from '../ui/Page';
import { CatalogError } from './catalog/CatalogError';
import { Poster } from './catalog/Poster';
import styles from './catalog/Catalog.module.css';

export function Home() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').slice(0, 300);
  const filter = params.get('type');
  const type: MediaType | undefined = filter === 'movie' || filter === 'tv' ? filter : undefined;
  const [input, setInput] = useState(query);
  const { data: secrets, error: secretsError } = useSecretsStatus();
  const hasKey = secrets?.set['tmdb.token'] === true;
  const results = useCatalogSearch(query, type, hasKey);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (input.trim() !== query) setParams({ q: input.trim(), ...(type ? { type } : {}) }, { replace: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [input, query, type, setParams]);

  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const links = Array.from(list.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (current < 0) return;
    const delta = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    event.preventDefault();
    links[(current + delta + links.length) % links.length]?.focus();
  };

  return (
    <Page title={t('catalog.title')} label={t('nav.search')} testId="screen-home">
      <p className={styles.muted}>{t('catalog.subtitle')}</p>
      <form
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault();
          setParams({ q: input.trim(), ...(type ? { type } : {}) }, { replace: true });
        }}
      >
        <label className={styles.searchField}>
          <span className="label">{t('catalog.searchLabel')}</span>
          <TextInput
            type="search"
            value={input}
            maxLength={300}
            placeholder={t('catalog.searchPlaceholder')}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary">
          <Search size={16} aria-hidden />
          {t('catalog.search')}
        </Button>
      </form>
      <div className={styles.filters} role="group" aria-label={t('catalog.filter')}>
        {([undefined, 'movie', 'tv'] as const).map((value) => (
          <Button
            key={value ?? 'all'}
            size="sm"
            aria-pressed={type === value}
            variant={type === value ? 'primary' : 'secondary'}
            onClick={() => setParams({ q: input.trim(), ...(value ? { type: value } : {}) }, { replace: true })}
          >
            {t(value === 'movie' ? 'catalog.movies' : value === 'tv' ? 'catalog.series' : 'catalog.all')}
          </Button>
        ))}
      </div>
      {secretsError ? (
        <CatalogError error={secretsError} />
      ) : !secrets ? (
        <p role="status">{t('app.loading')}</p>
      ) : !hasKey ? (
        <CatalogError error={new ApiError({ code: 'TMDB_NO_KEY', message: '' })} />
      ) : !query ? (
        <p className={styles.empty}>{t('catalog.empty')}</p>
      ) : results.error ? (
        <CatalogError error={results.error} retry={() => void results.refetch()} />
      ) : results.isPending || input.trim() !== query ? (
        <p role="status">{t('app.loading')}</p>
      ) : (
        <>
          <p role="status" className={styles.muted}>
            {results.data?.length
              ? t('catalog.results', { count: results.data.length })
              : t('catalog.noResults', { query })}
          </p>
          <ul ref={list} className={styles.grid} onKeyDown={moveFocus}>
            {results.data?.map((item) => (
              <li key={`${item.type}:${item.tmdbId}`}>
                <Link
                  className={styles.result}
                  to={`/title/${item.type}/${item.tmdbId}`}
                  state={{ search: `/?${params.toString()}` }}
                >
                  <Poster path={item.posterPath} />
                  <div className={styles.cardBody}>
                    <span className="label">
                      {t(`catalog.${item.type}`)} · {item.year ?? t('catalog.unknownYear')}
                    </span>
                    <h2>{item.title}</h2>
                    {item.originalTitle !== item.title ? <p className={styles.muted}>{item.originalTitle}</p> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
