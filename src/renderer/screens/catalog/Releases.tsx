import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Download, RefreshCw, XCircle } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Release, SessionSource } from '@shared/contracts/releases';
import { type ReleaseSort } from '@shared/domain/match';
import { filterReleases, RESOLUTION_FILTERS, type ResolutionFilter } from '@shared/domain/release-list';
import { searchTargetSchema } from '@shared/domain/search-target';
import { ApiError } from '../../api/bridge';
import { useReleaseSearch } from '../../api/releases';
import { formatAgo, formatBytes } from '../../format';
import { t, tDynamic } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice, errorText } from '../../ui/ErrorNotice';
import { Select } from '../../ui/Form';
import { Card, Page } from '../../ui/Page';
import styles from './Releases.module.css';

function SourceIcon({ s }: { s: SessionSource }) {
  if (s.state === 'pending') return <CircleDashed size={13} aria-hidden className={styles.spin} />;
  if (s.state === 'ok') return <CheckCircle2 size={13} aria-hidden className={styles.ok} />;
  if (s.state === 'empty') return <CheckCircle2 size={13} aria-hidden className={styles.muted} />;
  return <XCircle size={13} aria-hidden className={styles.err} />;
}

function sourceStateText(s: SessionSource): string {
  if (s.state === 'ok') return t('releases.sourceState.ok', { count: s.count });
  if (s.state === 'error' && s.errorCode)
    return errorText(new ApiError({ code: s.errorCode as never, message: '' })).message;
  return t(`releases.sourceState.${s.state}`);
}

const unknown = () => <span className={styles.unknown}>{t('releases.unknown')}</span>;

export function Releases() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { target?: unknown; sessionId?: string } | null;
  const parsed = searchTargetSchema.safeParse(state?.target);
  const target = useMemo(() => (parsed.success ? parsed.data : null), [parsed.success, parsed.data]);
  const { session, sessionId, error, refresh } = useReleaseSearch(target, state?.sessionId ?? null);
  const [filter, setFilter] = useState<ResolutionFilter>('all');
  const [sort, setSort] = useState<ReleaseSort>('match');

  const releases = useMemo(() => {
    return filterReleases(session?.releases ?? [], filter, sort);
  }, [session, filter, sort]);

  const back = target ? `/title/${target.kind === 'movie' ? 'movie' : 'tv'}/${target.tmdbId}` : '/';
  if (!target) {
    return (
      <Page title={t('catalog.releases')} label={t('catalog.releases')} testId="screen-releases">
        <Card>{t('catalog.invalidTarget')}</Card>
      </Page>
    );
  }

  const choose = (r: Release) => {
    if (!sessionId || !r.downloadable) return;
    // Keep the session in history so "back" shows the same results.
    void navigate(location.pathname, { replace: true, state: { target, sessionId } });
    void navigate('/download-setup', { state: { target, sessionId, releaseId: r.id, releaseName: r.name } });
  };

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, r: Release) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(r);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const row = event.currentTarget;
    const next = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
    (next as HTMLElement | null)?.focus();
  };

  const sources = session?.sources ?? [];
  const answered = sources.filter((s) => s.state !== 'pending').length;
  const done = session?.done ?? false;
  const subtitle =
    target.kind === 'episode'
      ? `${target.originalTitle} · ${t('catalog.selectedEpisode', { season: target.season, episode: target.episode })}`
      : `${target.originalTitle} · ${target.year ?? t('catalog.unknownYear')}`;

  return (
    <Page
      label={t('catalog.releases')}
      title={target.title}
      testId="screen-releases"
      actions={
        <>
          <Link className={styles.backLink} to={back}>
            <ArrowLeft size={14} aria-hidden /> {t('common.back')}
          </Link>
          <Button onClick={refresh} disabled={!done} data-testid="releases-refresh">
            <RefreshCw size={14} aria-hidden /> {t('releases.refresh')}
          </Button>
        </>
      }
    >
      <p className={styles.subtitle}>{subtitle}</p>
      {error ? <ErrorNotice error={error} /> : null}

      {sources.length > 0 ? (
        <details className={styles.sourcesBar} data-testid="releases-sources">
          <summary>
            <span aria-live="polite" role="status">
              {done ? null : <RefreshCw size={13} aria-hidden className={styles.spin} />}
              {t('releases.answered', { done: answered, total: sources.length })}
              {session?.fromCache ? <span className={styles.cache}> · {t('releases.fromCache')}</span> : null}
            </span>
            <span className={styles.summaryHint}>{t('releases.sourcesDetails')}</span>
          </summary>
          <ul className={styles.sourceList}>
            {sources.map((s) => (
              <li key={s.id} data-state={s.state}>
                <SourceIcon s={s} />
                <span className={styles.sourceName}>{s.name}</span>
                <span className={styles.muted}>{sourceStateText(s)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : !done && !error ? (
        <p role="status" className={styles.muted}>
          {t('releases.searching')}
        </p>
      ) : null}

      {session?.done && session.outcome === 'no_sources' ? (
        <Card className={styles.notice}>
          <p>{t('releases.noSources')}</p>
          <Link to="/settings">{t('releases.noSourcesAction')}</Link>
        </Card>
      ) : null}
      {session?.done && session.outcome === 'all_failed' ? (
        <ErrorNotice error={new ApiError({ code: 'ALL_SOURCES_FAILED', message: '' })} />
      ) : null}
      {session?.done && session.outcome === 'none' ? (
        <Card className={styles.notice}>
          <p>{t('releases.none')}</p>
          <p className={styles.muted}>{t('releases.noneHint')}</p>
        </Card>
      ) : null}

      {session && session.releases.length > 0 ? (
        <>
          <div className={styles.toolbar}>
            <div className={styles.chips} role="group" aria-label={t('releases.filterResolution')}>
              {RESOLUTION_FILTERS.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? 'primary' : 'secondary'}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? t('releases.allResolutions') : f === 'other' ? t('releases.otherResolution') : f}
                </Button>
              ))}
            </div>
            <label className={styles.sort}>
              <span className="label">{t('releases.sort')}</span>
              <Select value={sort} onChange={(e) => setSort(e.target.value as ReleaseSort)} data-testid="releases-sort">
                <option value="match">{t('releases.sortMatch')}</option>
                <option value="size">{t('releases.sortSize')}</option>
                <option value="seeders">{t('releases.sortSeeders')}</option>
              </Select>
            </label>
            <span className={styles.muted}>
              {t('releases.count', { shown: releases.length, total: session.releases.length })}
            </span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="releases-table">
              <thead>
                <tr>
                  <th scope="col">{t('releases.col.name')}</th>
                  <th scope="col">{t('releases.col.resolution')}</th>
                  <th scope="col">{t('releases.col.source')}</th>
                  <th scope="col">{t('releases.col.codec')}</th>
                  <th scope="col">{t('releases.col.hdr')}</th>
                  <th scope="col" className={styles.num}>
                    {t('releases.col.size')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('releases.col.seeders')}
                  </th>
                  <th scope="col">{t('releases.col.sources')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('releases.choose')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.id} tabIndex={0} onKeyDown={(e) => onRowKey(e, r)} onDoubleClick={() => choose(r)}>
                    <td className={styles.nameCell}>
                      <span className={styles.name} title={r.name}>
                        {r.name}
                      </span>
                      {r.match.warnings.length || r.parsed.languages.length || r.parsed.edition ? (
                        <span className={styles.badges}>
                          {r.match.warnings.map((w) => (
                            <span key={w} className={`${styles.badge} ${styles.warn}`}>
                              <AlertTriangle size={10} aria-hidden /> {tDynamic(`releases.warnings.${w}`, w)}
                            </span>
                          ))}
                          {r.parsed.edition ? <span className={styles.badge}>{r.parsed.edition}</span> : null}
                          {r.parsed.languages.map((l) => (
                            <span key={l} className={`${styles.badge} ${styles.lang}`}>
                              {l}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">{r.parsed.resolution ?? unknown()}</td>
                    <td>{r.parsed.source ?? unknown()}</td>
                    <td className="mono">{r.parsed.codec ?? unknown()}</td>
                    <td className="mono">{r.parsed.hdr ?? '—'}</td>
                    <td className={`${styles.num} mono`}>{formatBytes(r.size) ?? unknown()}</td>
                    <td className={styles.num}>
                      {r.seeders ? (
                        <span
                          title={t('releases.seedersBy', {
                            source: r.seeders.sourceName,
                            ago: formatAgo(r.seeders.observedAt),
                          })}
                        >
                          <span className="mono">{r.seeders.value}</span>
                          <span className={styles.by}>
                            {t('releases.seedersBy', {
                              source: r.seeders.sourceName,
                              ago: formatAgo(r.seeders.observedAt),
                            })}
                          </span>
                        </span>
                      ) : (
                        unknown()
                      )}
                    </td>
                    <td className={styles.sourcesCell} title={r.sources.map((s) => s.name).join(', ')}>
                      {[...new Set(r.sources.map((s) => s.name))].join(', ')}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!r.downloadable}
                        onClick={() => choose(r)}
                        tabIndex={-1}
                      >
                        <Download size={12} aria-hidden /> {t('releases.choose')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>{t('releases.chooseHint')}</p>
        </>
      ) : null}
    </Page>
  );
}
