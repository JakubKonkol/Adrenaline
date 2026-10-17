import { useState } from 'react';
import type { CatalogItem } from '@shared/contracts/catalog';
import type { CatalogCollection } from '@shared/contracts/catalog';
import { image } from '../api';
import { useDebounced, useQuery } from '../data';
import { errorText, t } from '../i18n';
import { useNav } from '../nav';
import { useSession } from '../session';
import { Button, Focusable, Message, Picture, Row, Spinner } from '../ui';
import { TextField } from './Connect';

/** Landscape card (backdrop) used in the Discover rows. */
function WideCard({ item, group }: { item: CatalogItem; group: string }) {
  const nav = useNav();
  return (
    <Focusable
      group={group}
      focusKey={`${group}-${item.type}-${item.tmdbId}`}
      className="card card-wide"
      label={item.title}
      onSelect={() => nav.push({ name: 'details', type: item.type, tmdbId: item.tmdbId })}
    >
      <Picture
        className="card-image"
        src={image(item.backdropPath, 'w780') ?? image(item.posterPath, 'w500')}
        alt={item.title}
      />
      <div className="card-caption">
        <span className="card-title">{item.title}</span>
        <span className="card-meta">{item.year ?? ''}</span>
      </div>
    </Focusable>
  );
}

export function PosterCard({
  item,
  group,
  onSelect,
}: {
  item: Pick<CatalogItem, 'title' | 'posterPath' | 'year' | 'type' | 'tmdbId'>;
  group: string;
  onSelect?: () => void;
}) {
  const nav = useNav();
  return (
    <Focusable
      group={group}
      focusKey={`${group}-${item.type}-${item.tmdbId}`}
      className="card card-poster"
      label={item.title}
      onSelect={onSelect ?? (() => nav.push({ name: 'details', type: item.type, tmdbId: item.tmdbId }))}
    >
      <Picture className="card-image" src={image(item.posterPath, 'w342')} alt={item.title} />
      <div className="card-caption">
        <span className="card-title">{item.title}</span>
        <span className="card-meta">
          {item.type === 'tv' ? t('details.tv') : t('details.movie')}
          {item.year ? ` · ${item.year}` : ''}
        </span>
      </div>
    </Focusable>
  );
}

function Hero({ item }: { item: CatalogItem }) {
  const nav = useNav();
  return (
    <section className="hero">
      <Picture className="hero-image" src={image(item.backdropPath, 'w1280')} alt="" />
      <div className="hero-shade" />
      <div className="hero-body">
        <span className="eyebrow">{item.type === 'tv' ? t('details.tv') : t('details.movie')}</span>
        <h1 className="hero-title">{item.title}</h1>
        {item.year ? <span className="hero-meta">{item.year}</span> : null}
        <p className="hero-overview">{item.overview}</p>
        <div className="actions">
          <Button
            primary
            focusKey="hero-details"
            group="hero"
            onSelect={() => nav.push({ name: 'details', type: item.type, tmdbId: item.tmdbId })}
          >
            {t('discover.details')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function CollectionRow({ type, collection }: { type: 'movie' | 'tv'; collection: CatalogCollection }) {
  const { api } = useSession();
  const id = `collection:${type}:${collection}`;
  const result = useQuery(id, () => api.collection(type, collection));
  if (result.loading) return <Spinner label={t(`discover.collections.${collection}`)} />;
  if (result.error)
    return (
      <Message
        title={t(`discover.collections.${collection}`)}
        body={errorText(result.error.code)}
        action={t('app.retry')}
        onAction={result.reload}
      />
    );
  if (!result.data?.length) return null;
  return (
    <Row
      title={`${t(`discover.collections.${collection}`)} · ${t(type === 'movie' ? 'details.movie' : 'details.tv')}`}
      id={id}
    >
      {result.data.map((item) => (
        <PosterCard key={item.tmdbId} item={item} group={id} />
      ))}
    </Row>
  );
}

export function Discover() {
  const { api } = useSession();
  const [query, setQuery] = useState('');
  const settled = useDebounced(query.trim(), 600);
  const movies = useQuery('trending:movie', () => api.trending('movie'));
  const shows = useQuery('trending:tv', () => api.trending('tv'));
  const results = useQuery(settled ? `search:${settled}` : null, () => api.search(settled));
  const hero = movies.data?.find((m) => m.backdropPath) ?? movies.data?.[0];
  const error = movies.error ?? shows.error;

  return (
    <div className="discover">
      <div className="search-bar">
        <TextField
          value={query}
          onChange={setQuery}
          placeholder={t('discover.search')}
          label={t('discover.searchHint')}
          focusKey="discover-search"
          inputMode="search"
        />
      </div>
      {settled ? (
        results.loading && !results.data ? (
          <Spinner />
        ) : results.error ? (
          <Message title={errorText(results.error.code)} action={t('app.retry')} onAction={results.reload} />
        ) : results.data && results.data.length > 0 ? (
          <section className="grid-section">
            <h2 className="row-title">{t('discover.results', { query: settled })}</h2>
            <div className="poster-grid">
              {results.data.map((item) => (
                <PosterCard key={`${item.type}-${item.tmdbId}`} item={item} group="results" />
              ))}
            </div>
          </section>
        ) : (
          <Message title={t('discover.noResults', { query: settled })} />
        )
      ) : error ? (
        <Message
          title={error.code === 'TMDB_NO_KEY' ? t('discover.noKey') : errorText(error.code)}
          action={t('app.retry')}
          onAction={() => {
            movies.reload();
            shows.reload();
          }}
        />
      ) : !movies.data ? (
        <Spinner />
      ) : (
        <>
          {hero ? <Hero item={hero} /> : null}
          <Row title={t('discover.trendingMovies')} id="trending-movies">
            {movies.data.map((item) => (
              <WideCard key={item.tmdbId} item={item} group="trending-movies" />
            ))}
          </Row>
          {shows.data && shows.data.length > 0 ? (
            <Row title={t('discover.trendingShows')} id="trending-shows">
              {shows.data.map((item) => (
                <WideCard key={item.tmdbId} item={item} group="trending-shows" />
              ))}
            </Row>
          ) : null}
          <CollectionRow type="movie" collection="now_playing" />
          <CollectionRow type="movie" collection="top_rated" />
          <CollectionRow type="tv" collection="top_rated" />
          <CollectionRow type="tv" collection="on_the_air" />
          <CollectionRow type="movie" collection="action" />
          <CollectionRow type="movie" collection="comedy" />
          <CollectionRow type="movie" collection="scifi" />
          <CollectionRow type="movie" collection="upcoming" />
        </>
      )}
    </div>
  );
}
