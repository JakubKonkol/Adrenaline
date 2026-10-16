import { useState } from 'react';
import type { TvLibraryItem } from '@shared/contracts/tv';
import { image } from '../api';
import { useQuery } from '../data';
import { errorText, t } from '../i18n';
import { useNav } from '../nav';
import { useSession } from '../session';
import { Button, Focusable, Message, Picture, Spinner } from '../ui';

export function runtimeText(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t('details.minutes', { h, m }) : t('details.minutesOnly', { m });
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
    <path fill="currentColor" d="M7 4.5v15l12.5-7.5z" />
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
    <path fill="currentColor" d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM5 19h14v2H5z" />
  </svg>
);
export { DownloadIcon, PlayIcon };

export function Details({ type, tmdbId }: { type: 'movie' | 'tv'; tmdbId: number }) {
  const { api } = useSession();
  const nav = useNav();
  const details = useQuery(`details:${type}:${tmdbId}`, () => api.details(type, tmdbId));
  const library = useQuery('library', () => api.library());
  const owned = (library.data ?? []).filter(
    (i) => i.tmdbId === tmdbId && i.kind === (type === 'movie' ? 'movie' : 'episode'),
  );
  const d = details.data;
  const seasons = (d?.seasons ?? []).filter((s) => s.number > 0 && s.episodeCount > 0);
  const [season, setSeason] = useState<number | null>(null);
  const activeSeason = season ?? seasons[0]?.number ?? null;
  const episodes = useQuery(type === 'tv' && activeSeason !== null ? `season:${tmdbId}:${activeSeason}` : null, () =>
    api.season(tmdbId, activeSeason!),
  );

  if (details.error)
    return <Message title={errorText(details.error.code)} action={t('app.retry')} onAction={details.reload} />;
  if (!d) return <Spinner />;

  const movieFile: TvLibraryItem | undefined = type === 'movie' ? owned.find((i) => i.available) : undefined;
  const meta = [d.year, d.genres.slice(0, 3).join(', '), runtimeText(d.runtime)].filter(Boolean).join(' · ');
  const play = (item: TvLibraryItem) => nav.push({ name: 'player', itemId: item.id });

  return (
    <div className="screen details" data-page="">
      <div className="backdrop">
        <Picture
          className="backdrop-image"
          src={image(d.backdropPath, 'w1280') ?? image(d.posterPath, 'w780')}
          alt=""
        />
        <div className="backdrop-shade" />
      </div>
      <div className="details-body">
        <span className="eyebrow">{type === 'tv' ? t('details.tv') : t('details.movie')}</span>
        <h1 className="details-title">{d.title}</h1>
        <div className="details-meta">{meta}</div>
        <p className="details-overview">{d.overview || t('details.noOverview')}</p>
        {type === 'movie' ? (
          <div className="actions">
            {movieFile ? (
              <Button primary autoFocus focusKey="details-play" icon={<PlayIcon />} onSelect={() => play(movieFile)}>
                {movieFile.resumeMs ? t('details.resume') : t('details.play')}
              </Button>
            ) : null}
            <Button
              primary={!movieFile}
              autoFocus={!movieFile}
              focusKey="details-download"
              icon={<DownloadIcon />}
              onSelect={() =>
                nav.push({
                  name: 'releases',
                  selection: { type: 'movie', tmdbId },
                  title: d.title,
                  subtitle: d.year ? String(d.year) : null,
                })
              }
            >
              {t('details.download')}
            </Button>
            {movieFile ? <span className="pill">{t('details.inLibrary')}</span> : null}
          </div>
        ) : (
          <>
            <div className="chips" data-row="seasons">
              {seasons.map((s, i) => (
                <Focusable
                  key={s.number}
                  group="seasons"
                  focusKey={`season-${s.number}`}
                  autoFocus={i === 0}
                  className={`chip ${s.number === activeSeason ? 'is-active' : ''}`}
                  onSelect={() => setSeason(s.number)}
                  onFocus={() => setSeason(s.number)}
                >
                  {s.name || t('details.season', { n: s.number })}
                </Focusable>
              ))}
            </div>
            <div className="episodes">
              {episodes.loading && !episodes.data ? <Spinner /> : null}
              {episodes.error ? <p className="error-text">{errorText(episodes.error.code)}</p> : null}
              {episodes.data?.episodes.map((e) => {
                const file = owned.find((i) => i.season === e.season && i.episode === e.number && i.available);
                return (
                  <Focusable
                    key={e.number}
                    group="episodes"
                    focusKey={`episode-${e.season}-${e.number}`}
                    className="episode"
                    onSelect={() =>
                      file
                        ? play(file)
                        : nav.push({
                            name: 'releases',
                            selection: { type: 'tv', tmdbId, season: e.season, episode: e.number },
                            title: d.title,
                            subtitle: `S${String(e.season).padStart(2, '0')}E${String(e.number).padStart(2, '0')} · ${e.title}`,
                          })
                    }
                  >
                    <span className="episode-number">{e.number}</span>
                    <div className="episode-text">
                      <span className="episode-title">{e.title}</span>
                      <span className="episode-overview">{e.overview}</span>
                    </div>
                    <span className={`episode-action ${file ? 'is-owned' : ''}`}>
                      {file ? <PlayIcon /> : <DownloadIcon />}
                    </span>
                  </Focusable>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
