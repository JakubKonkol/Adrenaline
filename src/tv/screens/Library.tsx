import { useState } from 'react';
import type { TvDownload, TvLibraryItem } from '@shared/contracts/tv';
import { image } from '../api';
import { invalidate, useQuery } from '../data';
import { errorText, t } from '../i18n';
import { useNav } from '../nav';
import { useSession } from '../session';
import { Button, Focusable, Message, Modal, Picture, ProgressBar, Row, Spinner } from '../ui';

export function episodeCode(item: { season: number | null; episode: number | null }): string {
  return `S${String(item.season ?? 0).padStart(2, '0')}E${String(item.episode ?? 0).padStart(2, '0')}`;
}

/** Status line of a download as seen on the TV. */
export function downloadStatus(d: TvDownload): string {
  if (d.needsFileChoice) return t('library.chooseOnPc');
  switch (d.status) {
    case 'queued':
      return t('library.queued');
    case 'fetching_metadata':
      return t('library.metadata');
    case 'paused':
    case 'paused_disk_full':
    case 'paused_disk_missing':
      return t('library.paused');
    case 'checking':
      return t('library.checking');
    case 'error':
      return t('library.error');
    case 'subtitles_in_progress':
      return t('library.subtitles');
    case 'ready':
    case 'ready_subtitles_attention':
      return t('library.ready');
    default: {
      const pct = d.percent === null ? '' : `${Math.floor(d.percent)}%`;
      const rate = d.downloadRate > 0 ? ` · ${(d.downloadRate / 1024 / 1024).toFixed(1)} MB/s` : '';
      return `${pct}${rate}`;
    }
  }
}

export interface ShowGroup {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  items: TvLibraryItem[];
}

export function groupShows(items: TvLibraryItem[]): ShowGroup[] {
  const map = new Map<number, ShowGroup>();
  for (const item of items) {
    if (item.kind !== 'episode') continue;
    const g = map.get(item.tmdbId) ?? { tmdbId: item.tmdbId, title: item.title, posterPath: null, items: [] };
    g.posterPath ??= item.posterPath;
    g.items.push(item);
    map.set(item.tmdbId, g);
  }
  for (const g of map.values())
    g.items.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  return [...map.values()];
}

function LibraryCard({ item, group, label }: { item: TvLibraryItem; group: string; label?: string }) {
  const nav = useNav();
  const progress = item.resumeMs && item.durationMs ? (item.resumeMs / item.durationMs) * 100 : null;
  return (
    <Focusable
      group={group}
      focusKey={`${group}-${item.id}`}
      className={`card card-poster ${item.available ? '' : 'is-missing'}`}
      label={item.title}
      disabled={!item.available}
      onSelect={() => nav.push({ name: 'player', itemId: item.id })}
    >
      <Picture className="card-image" src={image(item.posterPath, 'w342')} alt={item.title} />
      {progress !== null ? <ProgressBar value={progress} /> : null}
      <div className="card-caption">
        <span className="card-title">{item.title}</span>
        <span className="card-meta">
          {!item.available ? t('library.missing') : (label ?? (item.year ? String(item.year) : ''))}
        </span>
      </div>
    </Focusable>
  );
}

export function Library() {
  const { api } = useSession();
  const nav = useNav();
  const library = useQuery('library', () => api.library(), 10_000);
  const downloads = useQuery('downloads', () => api.downloads(), 3_000);
  const [acting, setActing] = useState<TvDownload | null>(null);

  if (library.error && !library.data)
    return <Message title={errorText(library.error.code)} action={t('app.retry')} onAction={library.reload} />;
  if (!library.data) return <Spinner />;

  const items = library.data;
  const active = (downloads.data ?? []).filter((d) => d.state !== 'completed' && d.state !== 'removed');
  const resume = items.filter((i) => i.available && i.resumeMs !== null);
  const movies = items.filter((i) => i.kind === 'movie');
  const shows = groupShows(items);

  if (items.length === 0 && active.length === 0)
    return (
      <Message
        title={t('library.empty')}
        body={t('library.emptyBody')}
        action={t('nav.discover')}
        onAction={() => nav.replace({ name: 'home', tab: 'discover' })}
      />
    );

  return (
    <div className="library">
      {resume.length > 0 ? (
        <Row title={t('library.continue')} id="continue">
          {resume.map((item) => (
            <LibraryCard
              key={item.id}
              item={item}
              group="continue"
              label={item.kind === 'episode' ? episodeCode(item) : undefined}
            />
          ))}
        </Row>
      ) : null}
      {active.length > 0 ? (
        <Row title={t('library.downloading')} id="downloading">
          {active.map((d) => (
            <Focusable
              key={d.id}
              group="downloading"
              focusKey={`downloading-${d.id}`}
              className="card card-poster card-download"
              label={d.title}
              onSelect={() => setActing(d)}
            >
              <Picture className="card-image" src={image(d.posterPath, 'w342')} alt={d.title} />
              <ProgressBar value={d.percent} />
              <div className="card-caption">
                <span className="card-title">
                  {d.title}
                  {d.kind === 'episode' ? ` · ${episodeCode(d)}` : ''}
                </span>
                <span className="card-meta">{downloadStatus(d)}</span>
              </div>
            </Focusable>
          ))}
        </Row>
      ) : null}
      {movies.length > 0 ? (
        <Row title={t('library.movies')} id="movies">
          {movies.map((item) => (
            <LibraryCard key={item.id} item={item} group="movies" />
          ))}
        </Row>
      ) : null}
      {shows.length > 0 ? (
        <Row title={t('library.shows')} id="shows">
          {shows.map((show) => (
            <Focusable
              key={show.tmdbId}
              group="shows"
              focusKey={`shows-${show.tmdbId}`}
              className="card card-poster"
              label={show.title}
              onSelect={() => nav.push({ name: 'show', tmdbId: show.tmdbId, title: show.title })}
            >
              <Picture className="card-image" src={image(show.posterPath, 'w342')} alt={show.title} />
              <div className="card-caption">
                <span className="card-title">{show.title}</span>
                <span className="card-meta">
                  {show.items.length === 1 ? t('library.episode') : t('library.episodes', { count: show.items.length })}
                </span>
              </div>
            </Focusable>
          ))}
        </Row>
      ) : null}
      {acting ? (
        <DownloadActions
          download={acting}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            invalidate('downloads');
            downloads.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function DownloadActions({
  download,
  onClose,
  onDone,
}: {
  download: TvDownload;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useSession();
  const nav = useNav();
  const paused = download.state === 'paused' || download.state === 'error';
  const run = (fn: () => Promise<unknown>) =>
    void fn().then(onDone, (e: unknown) => {
      nav.showToast(errorText((e as { code?: string }).code ?? 'NETWORK'));
      onClose();
    });
  return (
    <Modal title={download.title} onClose={onClose}>
      <p className="modal-text">{downloadStatus(download)}</p>
      <p className="modal-release">{download.releaseName}</p>
      <div className="actions">
        <Button
          primary
          autoFocus
          focusKey="dl-toggle"
          onSelect={() => run(() => api.downloadAction(download.id, paused ? 'resume' : 'pause'))}
        >
          {paused ? t('library.resume') : t('library.pause')}
        </Button>
        <Button focusKey="dl-remove" onSelect={() => run(() => api.removeDownload(download.id))}>
          {t('library.removeFromQueue')}
        </Button>
        <Button focusKey="dl-close" onSelect={onClose}>
          {t('app.close')}
        </Button>
      </div>
      <p className="modal-hint">{t('library.removeHint')}</p>
    </Modal>
  );
}

/** Episodes of one show that are in the library. */
export function Show({ tmdbId, title }: { tmdbId: number; title: string }) {
  const { api } = useSession();
  const nav = useNav();
  const library = useQuery('library', () => api.library());
  const show = groupShows(library.data ?? []).find((s) => s.tmdbId === tmdbId);
  return (
    <div className="screen show" data-page="">
      <div className="backdrop">
        <Picture className="backdrop-image backdrop-blur" src={image(show?.posterPath, 'w780')} alt="" />
        <div className="backdrop-shade" />
      </div>
      <div className="details-body">
        <span className="eyebrow">{t('details.tv')}</span>
        <h1 className="details-title">{title}</h1>
        <div className="actions">
          <Button focusKey="show-details" onSelect={() => nav.push({ name: 'details', type: 'tv', tmdbId })}>
            {t('discover.details')}
          </Button>
        </div>
        <div className="episodes">
          {!library.data ? <Spinner /> : null}
          {show?.items.map((item, i) => (
            <Focusable
              key={item.id}
              group="show-episodes"
              focusKey={`show-${item.id}`}
              autoFocus={i === 0}
              disabled={!item.available}
              className="episode"
              onSelect={() => nav.push({ name: 'player', itemId: item.id })}
            >
              <span className="episode-number">{episodeCode(item)}</span>
              <div className="episode-text">
                <span className="episode-title">{item.episodeTitle ?? item.fileName}</span>
                <span className="episode-overview">{item.available ? item.fileName : t('library.missing')}</span>
              </div>
              {item.resumeMs && item.durationMs ? (
                <div className="episode-progress">
                  <ProgressBar value={(item.resumeMs / item.durationMs) * 100} />
                </div>
              ) : null}
            </Focusable>
          ))}
        </div>
      </div>
    </div>
  );
}
