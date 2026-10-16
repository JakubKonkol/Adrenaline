import { useEffect, useState } from 'react';
import type { Release, ReleaseSession } from '@shared/contracts/releases';
import { ApiError, type Selection } from '../api';
import { invalidate } from '../data';
import { errorText, t } from '../i18n';
import { useNav } from '../nav';
import { useSession } from '../session';
import { Button, Focusable, Message, Modal, Spinner } from '../ui';

export function formatSize(bytes: number | null): string {
  if (bytes === null) return t('releases.unknownSize');
  const gib = bytes / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function chips(r: Release): string[] {
  const p = r.parsed;
  return [p.resolution, p.source, p.codec, p.hdr, ...p.audio.slice(0, 1)].filter((x): x is string => !!x);
}

export function Releases({
  selection,
  title,
  subtitle,
}: {
  selection: Selection;
  title: string;
  subtitle: string | null;
}) {
  const { api, session } = useSession();
  const nav = useNav();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [data, setData] = useState<ReleaseSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Release | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let id: string | null = null;
    const poll = (sid: string) => {
      api.releaseSession(sid).then(
        (s) => {
          if (!alive) return;
          setData(s);
          if (!s.done) timer = setTimeout(() => poll(sid), 1_000);
        },
        (e: unknown) => alive && setError(errorText(e instanceof ApiError ? e.code : 'NETWORK')),
      );
    };
    api.startReleaseSearch(selection).then(
      (r) => {
        if (!alive) return;
        id = r.sessionId;
        setSessionId(r.sessionId);
        poll(r.sessionId);
      },
      (e: unknown) => alive && setError(errorText(e instanceof ApiError ? e.code : 'NETWORK')),
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      if (id) void api.cancelReleaseSearch(id).catch(() => undefined);
    };
    // A new search only when the title changes or the user retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, nonce]);

  const retry = () => {
    setError(null);
    setData(null);
    setNonce((n) => n + 1);
  };
  const done = data?.sources.filter((s) => s.state !== 'pending').length ?? 0;
  const total = data?.sources.length ?? 0;
  const releases = data?.releases.filter((r) => r.downloadable) ?? [];

  return (
    <div className="screen releases" data-page="">
      <header className="screen-header">
        <span className="eyebrow">{t('releases.title')}</span>
        <h1>{title}</h1>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
        <p className="screen-status">
          {data && !data.done
            ? t('releases.searching', { done, total })
            : data
              ? t('releases.found', { count: releases.length })
              : ''}
        </p>
      </header>
      {error ? (
        <Message title={error} action={t('app.retry')} onAction={retry} />
      ) : !data ? (
        <Spinner />
      ) : releases.length === 0 && data.done ? (
        <Message
          title={
            data.outcome === 'no_sources'
              ? t('releases.noSources')
              : data.outcome === 'all_failed'
                ? t('releases.allFailed')
                : t('releases.none')
          }
          action={t('app.retry')}
          onAction={retry}
        />
      ) : (
        <div className="release-list">
          {releases.map((r, i) => (
            <Focusable
              key={r.id}
              group="releases"
              focusKey={`release-${r.id}`}
              autoFocus={i === 0}
              className="release"
              onSelect={() => setChosen(r)}
            >
              <div className="release-main">
                <div className="release-chips">
                  {i === 0 ? <span className="badge badge-accent">{t('releases.best')}</span> : null}
                  {chips(r).map((c) => (
                    <span key={c} className="badge">
                      {c}
                    </span>
                  ))}
                </div>
                <span className="release-name">{r.name}</span>
              </div>
              <div className="release-side">
                <span className="release-size">{formatSize(r.size)}</span>
                <span className="release-seeders">
                  {r.seeders ? t('releases.seeders', { n: r.seeders.value }) : '—'}
                </span>
                <span className="release-match">{r.match.score}%</span>
              </div>
            </Focusable>
          ))}
          {!data.done ? <Spinner /> : null}
        </div>
      )}
      {chosen && sessionId ? (
        <Confirm
          release={chosen}
          subtitlesAvailable={session.features.subtitles}
          onClose={() => setChosen(null)}
          onStart={async (subtitles) => {
            try {
              await api.createDownload(sessionId, chosen.id, subtitles);
              invalidate('downloads');
              nav.showToast(t('releases.started'));
              nav.reset({ name: 'home', tab: 'library' });
            } catch (e) {
              const code = e instanceof ApiError ? e.code : 'NETWORK';
              setChosen(null);
              nav.showToast(
                code === 'DUPLICATE_JOB'
                  ? t('releases.duplicate')
                  : code === 'NOT_FOUND'
                    ? t('releases.gone')
                    : errorText(code),
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}

function Confirm({
  release,
  subtitlesAvailable,
  onClose,
  onStart,
}: {
  release: Release;
  subtitlesAvailable: boolean;
  onClose: () => void;
  onStart: (subtitles: boolean) => Promise<void>;
}) {
  const [subtitles, setSubtitles] = useState(subtitlesAvailable);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t('releases.confirmTitle')} onClose={onClose}>
      <p className="modal-text">{t('releases.confirmBody')}</p>
      <p className="modal-release">
        {release.name} · {formatSize(release.size)}
      </p>
      <Focusable
        className="toggle-row"
        focusKey="confirm-subtitles"
        disabled={!subtitlesAvailable}
        onSelect={() => setSubtitles((s) => !s)}
      >
        <span>{t('releases.subtitles')}</span>
        <span className={`toggle ${subtitles ? 'is-on' : ''}`}>
          {!subtitlesAvailable
            ? t('releases.subtitlesNoAccount')
            : subtitles
              ? t('releases.subtitlesOn')
              : t('releases.subtitlesOff')}
        </span>
      </Focusable>
      <div className="actions">
        {busy ? (
          <Spinner />
        ) : (
          <>
            <Button
              primary
              autoFocus
              focusKey="confirm-start"
              onSelect={() => {
                setBusy(true);
                void onStart(subtitles).finally(() => setBusy(false));
              }}
            >
              {t('releases.start')}
            </Button>
            <Button focusKey="confirm-cancel" onSelect={onClose}>
              {t('app.cancel')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
