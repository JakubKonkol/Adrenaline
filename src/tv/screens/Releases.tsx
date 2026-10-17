import { useEffect, useState } from 'react';
import type { Release, ReleaseSession } from '@shared/contracts/releases';
import type { TvSubtitleChoices } from '@shared/contracts/tv';
import type { SubtitleProvider } from '@shared/contracts/subtitles';
import { SUBTITLE_PROVIDERS } from '@shared/domain/subtitle-providers';
import type { ReleaseSort } from '@shared/domain/match';
import { filterReleases, RESOLUTION_FILTERS, type ResolutionFilter } from '@shared/domain/release-list';
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
  const [quality, setQuality] = useState<ResolutionFilter>('all');
  const [sort, setSort] = useState<ReleaseSort>('match');
  const [source, setSource] = useState('all');
  const [codec, setCodec] = useState('all');

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
  const available = data?.releases.filter((r) => r.downloadable) ?? [];
  const releases = filterReleases(available, quality, sort, source, codec);
  const sources = ['all', ...new Set(available.flatMap((r) => (r.parsed.source ? [r.parsed.source] : [])))];
  const codecs = ['all', ...new Set(available.flatMap((r) => (r.parsed.codec ? [r.parsed.codec] : [])))];
  const sorts: ReleaseSort[] = ['match', 'seeders', 'size'];

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
      {data && available.length > 0 ? (
        <div className="release-filters">
          <div className="actions" role="group" aria-label={t('releases.quality')}>
            {RESOLUTION_FILTERS.map((q) => (
              <Button
                key={q}
                primary={quality === q}
                group="quality"
                focusKey={`quality-${q}`}
                onSelect={() => setQuality(q)}
              >
                {q === 'all' ? t('releases.all') : q === 'other' ? t('releases.other') : q === '2160p' ? '4K' : q}
              </Button>
            ))}
          </div>
          <div className="actions">
            <Button focusKey="release-sort" onSelect={() => setSort(sorts[(sorts.indexOf(sort) + 1) % sorts.length]!)}>
              {t('releases.sort')}: {t(`releases.sorts.${sort}`)}
            </Button>
            <Button
              focusKey="release-source"
              onSelect={() => setSource(sources[(sources.indexOf(source) + 1) % sources.length]!)}
            >
              {t('releases.source')}: {source === 'all' ? t('releases.all') : source}
            </Button>
            <Button
              focusKey="release-codec"
              onSelect={() => setCodec(codecs[(codecs.indexOf(codec) + 1) % codecs.length]!)}
            >
              {t('releases.codec')}: {codec === 'all' ? t('releases.all') : codec}
            </Button>
            {quality !== 'all' || source !== 'all' || codec !== 'all' ? (
              <Button
                focusKey="release-clear"
                onSelect={() => {
                  setQuality('all');
                  setSource('all');
                  setCodec('all');
                }}
              >
                {t('releases.clear')}
              </Button>
            ) : null}
          </div>
          <p className="screen-status">{t('releases.filtered', { count: releases.length, total: available.length })}</p>
        </div>
      ) : null}
      {error ? (
        <Message title={error} action={t('app.retry')} onAction={retry} />
      ) : !data ? (
        <Spinner />
      ) : available.length === 0 && data.done ? (
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
          {releases.length === 0 ? <Message title={t('releases.noFilterResults')} /> : null}
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
                  {r.id === available[0]?.id ? <span className="badge badge-accent">{t('releases.best')}</span> : null}
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
          sessionId={sessionId}
          subtitlesAvailable={session.features.subtitles}
          onClose={() => setChosen(null)}
          onStart={async (subtitles, choice) => {
            try {
              await api.createDownload(sessionId, chosen.id, subtitles, choice);
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
  sessionId,
  subtitlesAvailable,
  onClose,
  onStart,
}: {
  release: Release;
  sessionId: string;
  subtitlesAvailable: boolean;
  onClose: () => void;
  onStart: (
    subtitles: boolean,
    choice?: { subtitleFileId?: number; subtitleProvider?: SubtitleProvider },
  ) => Promise<void>;
}) {
  const { api } = useSession();
  const [step, setStep] = useState<'question' | 'files'>('question');
  const [choices, setChoices] = useState<TvSubtitleChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = (subtitles: boolean, choice?: { subtitleFileId?: number; subtitleProvider?: SubtitleProvider }) => {
    if (busy) return;
    setBusy(true);
    void onStart(subtitles, choice).finally(() => setBusy(false));
  };
  const load = () => {
    setStep('files');
    setError(null);
    void api
      .subtitleChoices(sessionId, release.id)
      .then(setChoices, (e: unknown) => setError(errorText(e instanceof ApiError ? e.code : 'NETWORK')));
  };
  return (
    <Modal title={t(step === 'question' ? 'releases.subtitleQuestion' : 'releases.subtitleFiles')} onClose={onClose}>
      <p className="modal-text">{t('releases.confirmBody')}</p>
      <p className="modal-release">
        {release.name} · {formatSize(release.size)}
      </p>
      {busy ? (
        <Spinner />
      ) : step === 'question' ? (
        <>
          {!subtitlesAvailable ? <p className="modal-hint">{t('releases.subtitlesNoAccount')}</p> : null}
          <div className="actions">
            <Button
              primary
              autoFocus={subtitlesAvailable}
              focusKey="confirm-yes"
              disabled={!subtitlesAvailable}
              onSelect={load}
            >
              {t('releases.withSubtitles')}
            </Button>
            <Button
              primary={!subtitlesAvailable}
              autoFocus={!subtitlesAvailable}
              focusKey="confirm-no"
              onSelect={() => start(false)}
            >
              {t('releases.withoutSubtitles')}
            </Button>
            <Button focusKey="confirm-cancel" onSelect={onClose}>
              {t('app.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-hint">{t('releases.subtitleFilesHint')}</p>
          {error ? (
            <Message title={error} action={t('app.retry')} onAction={load} />
          ) : !choices ? (
            <Spinner />
          ) : (
            <>
              {choices.errorCode ? <p role="status">{t('releases.subtitleSearchFailed')}</p> : null}
              <div className="subtitle-choices" key="subtitle-files">
                {choices.candidates.map((c, index) => (
                  <Focusable
                    key={c.fileId}
                    group="subtitle-files"
                    focusKey={`subtitle-${c.fileId}`}
                    autoFocus={index === 0}
                    className="subtitle-choice"
                    onSelect={() => start(true, { subtitleFileId: c.fileId })}
                  >
                    <span className="badge">
                      {SUBTITLE_PROVIDERS[c.provider ?? 'opensubtitles']} · {c.language.toUpperCase()} · {c.confidence}
                    </span>
                    <span>{c.fileName || c.release}</span>
                    {c.release && c.fileName ? <small>{c.release}</small> : null}
                  </Focusable>
                ))}
              </div>
              {!choices.candidates.length ? <p className="modal-hint">{t('releases.noSubtitleFiles')}</p> : null}
              <div className="actions subtitle-actions">
                {choices.providers
                  .filter((p) => p !== 'opensubtitles')
                  .map((provider) => (
                    <Button
                      key={provider}
                      focusKey={`subtitle-provider-${provider}`}
                      onSelect={() => start(true, { subtitleProvider: provider })}
                    >
                      {t('releases.matchByFile', { provider: SUBTITLE_PROVIDERS[provider] })}
                    </Button>
                  ))}
                <Button focusKey="subtitle-auto" onSelect={() => start(true)}>
                  {t('releases.subtitleAuto')}
                </Button>
              </div>
            </>
          )}
          <div className="actions">
            <Button focusKey="subtitle-skip" onSelect={() => start(false)}>
              {t('releases.withoutSubtitles')}
            </Button>
            <Button focusKey="subtitle-back" onSelect={() => setStep('question')}>
              {t('app.back')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
