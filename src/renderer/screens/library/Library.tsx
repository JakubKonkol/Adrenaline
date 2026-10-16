import { AlertTriangle, Film, FolderOpen, Play, Trash2, Tv } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { LibraryItem } from '@shared/contracts/library';
import { languageName } from '@shared/domain/languages';
import { playLibraryItem, showLibraryItem, useLibrary, useRemoveLibraryItem } from '../../api/library';
import { formatBytes } from '../../format';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Page } from '../../ui/Page';
import { Poster } from '../catalog/Poster';
import styles from './Library.module.css';

type Filter = 'all' | 'movie' | 'episode';

interface Show {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  episodes: LibraryItem[];
}

/** Episodes grouped by show, in the order of the newest episode; episodes sorted by season and number. */
export function groupShows(items: LibraryItem[]): Show[] {
  const shows = new Map<number, Show>();
  for (const item of items) {
    if (item.kind !== 'episode') continue;
    const show = shows.get(item.tmdbId) ?? { tmdbId: item.tmdbId, title: item.title, posterPath: null, episodes: [] };
    show.posterPath ??= item.posterPath;
    show.episodes.push(item);
    shows.set(item.tmdbId, show);
  }
  for (const show of shows.values())
    show.episodes.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  return [...shows.values()];
}

export function episodeCode(item: LibraryItem): string {
  return `S${String(item.season ?? 0).padStart(2, '0')}E${String(item.episode ?? 0).padStart(2, '0')}`;
}

export function Library() {
  const { data, error, isPending } = useLibrary();
  const [filter, setFilter] = useState<Filter>('all');
  const [actionError, setActionError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<LibraryItem | null>(null);
  const items = data ?? [];
  const movies = items.filter((i) => i.kind === 'movie');
  const shows = groupShows(items);
  const run = (fn: () => Promise<void>) => {
    setActionError(null);
    void fn().catch(setActionError);
  };

  const actions = (item: LibraryItem, compact = false) => (
    <div className={styles.actions}>
      <Button
        size="sm"
        variant="primary"
        disabled={!item.available}
        onClick={() => run(() => playLibraryItem(item.id))}
        aria-label={t('library.playItem', { title: item.title })}
      >
        <Play size={13} aria-hidden /> {compact ? null : t('library.play')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!item.available}
        onClick={() => run(() => showLibraryItem(item.id))}
        aria-label={t('library.showInFolder')}
        title={t('library.showInFolder')}
      >
        <FolderOpen size={13} aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setRemoving(item)}
        aria-label={t('library.remove')}
        title={t('library.remove')}
      >
        <Trash2 size={13} aria-hidden />
      </Button>
    </div>
  );

  const meta = (item: LibraryItem) => (
    <span className={styles.meta}>
      {formatBytes(item.sizeBytes)}
      {item.subtitles.length ? ` · ${item.subtitles.map((l) => languageName(l)).join(', ')}` : ''}
      {!item.available ? (
        <span className={styles.missing}>
          <AlertTriangle size={11} aria-hidden /> {t('library.missing')}
        </span>
      ) : null}
    </span>
  );

  return (
    <Page title={t('library.title')} label={t('nav.library')} testId="screen-library">
      <p className={styles.muted}>{t('library.subtitle')}</p>
      <div className={styles.filters} role="group" aria-label={t('library.filter')}>
        {(['all', 'movie', 'episode'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            aria-pressed={filter === value}
            variant={filter === value ? 'primary' : 'secondary'}
            onClick={() => setFilter(value)}
          >
            {t(value === 'movie' ? 'library.movies' : value === 'episode' ? 'library.shows' : 'library.all')}
          </Button>
        ))}
      </div>
      {actionError ? <ErrorNotice error={actionError} compact /> : null}
      {error ? (
        <ErrorNotice error={error} />
      ) : isPending ? (
        <p role="status">{t('app.loading')}</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Film size={22} />}
          title={t('library.empty')}
          body={t('library.emptyBody')}
          action={<Link to="/">{t('library.findSomething')}</Link>}
          testId="library-empty"
        />
      ) : (
        <>
          {filter !== 'episode' && movies.length > 0 ? (
            <section className={styles.section} aria-labelledby="library-movies">
              <h2 id="library-movies" className="label">
                {t('library.movies')} · {movies.length}
              </h2>
              <ul className={styles.grid}>
                {movies.map((item) => (
                  <li key={item.id} className={styles.card} data-testid={`library-${item.id}`}>
                    <div className={item.available ? '' : styles.dimmed}>
                      <Poster path={item.posterPath} size="w342" />
                    </div>
                    <div className={styles.body}>
                      <h3 className={styles.title}>{item.title}</h3>
                      <span className="label">{item.year ?? t('catalog.unknownYear')}</span>
                      {meta(item)}
                      {actions(item)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {filter !== 'movie' && shows.length > 0 ? (
            <section className={styles.section} aria-labelledby="library-shows">
              <h2 id="library-shows" className="label">
                {t('library.shows')} · {shows.length}
              </h2>
              <ul className={styles.shows}>
                {shows.map((show) => (
                  <li key={show.tmdbId} className={styles.show}>
                    <div className={styles.showPoster}>
                      <Poster path={show.posterPath} />
                    </div>
                    <div className={styles.showBody}>
                      <h3 className={styles.title}>
                        <Tv size={14} aria-hidden /> {show.title}
                      </h3>
                      <ul className={styles.episodes}>
                        {show.episodes.map((ep) => (
                          <li key={ep.id} className={styles.episode} data-testid={`library-${ep.id}`}>
                            <span className={`mono ${styles.code}`}>{episodeCode(ep)}</span>
                            <span className={styles.epTitle}>{ep.episodeTitle ?? ep.fileName}</span>
                            {meta(ep)}
                            {actions(ep, true)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      <RemoveDialog item={removing} onClose={() => setRemoving(null)} />
    </Page>
  );
}

function RemoveDialog({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const remove = useRemoveLibraryItem();
  const close = () => {
    setDeleteFiles(false);
    remove.reset();
    onClose();
  };
  return (
    <Dialog
      open={item !== null}
      title={t('library.removeTitle')}
      onClose={close}
      testId="library-remove-dialog"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => item && remove.mutate({ id: item.id, deleteFiles }, { onSuccess: close })}
          >
            {t('library.removeConfirm')}
          </Button>
        </>
      }
    >
      <p>{t('library.removeBody', { title: item?.title ?? '' })}</p>
      <label className={styles.check}>
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
        {t('library.deleteFiles')}
      </label>
      {remove.error ? <ErrorNotice error={remove.error} compact /> : null}
    </Dialog>
  );
}
