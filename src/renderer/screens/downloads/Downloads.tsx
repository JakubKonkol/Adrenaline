import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderOpen,
  Info,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipForward,
  Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { DownloadJob } from '@shared/contracts/downloads';
import { openJobFolder, useDownloads, useJobProgress, usePause, useResume, useSetSubtitles } from '../../api/downloads';
import { formatBytes, formatDuration, formatRate } from '../../format';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Page } from '../../ui/Page';
import { ProgressBar } from '../../ui/ProgressBar';
import { StatusBadge } from './StatusBadge';
import { episodeLabel, isFinished, jobView } from './job-view';
import styles from './Downloads.module.css';

export function Downloads() {
  const navigate = useNavigate();
  const { data: jobs, error } = useDownloads();
  const list = jobs ?? [];
  const active = list.filter((j) => !isFinished(j));
  const finished = list.filter(isFinished);
  return (
    <Page label={t('nav.downloads')} title={t('downloads.title')} testId="screen-downloads">
      {error ? <ErrorNotice error={error} /> : null}
      {jobs && list.length === 0 ? (
        <EmptyState
          icon={<Download size={20} />}
          title={t('downloads.emptyTitle')}
          body={t('downloads.emptyBody')}
          action={
            <Button variant="primary" onClick={() => void navigate('/')}>
              <Search size={14} aria-hidden />
              {t('downloads.emptyAction')}
            </Button>
          }
        />
      ) : null}
      {active.length > 0 ? (
        <section aria-labelledby="dl-active">
          <h2 id="dl-active" className={`label ${styles.sectionTitle}`}>
            {t('downloads.active')} · {active.length}
          </h2>
          <ul className={styles.list}>
            {active.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        </section>
      ) : null}
      {finished.length > 0 ? (
        <section aria-labelledby="dl-finished">
          <h2 id="dl-finished" className={`label ${styles.sectionTitle}`}>
            {t('downloads.finished')} · {finished.length}
          </h2>
          <ul className={styles.list}>
            {finished.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}

function JobRow({ job }: { job: DownloadJob }) {
  const progress = useJobProgress(job.id);
  const pause = usePause();
  const resume = useResume();
  const subtitles = useSetSubtitles();
  const { status, total, done, percent } = jobView(job, progress);
  // D-78: the movie is done and only subtitles keep the download from being ready — offer to skip them.
  const canSkipSubtitles = status.kind === 'subtitles_in_progress' || status.kind === 'ready_subtitles_attention';
  const ep = episodeLabel(job);
  const canPause = [
    'queued',
    'fetching_metadata',
    'downloading',
    'checking',
    'seeding',
    'awaiting_file_selection',
  ].includes(job.state);
  const canResume = ['paused', 'error', 'stopped'].includes(job.state);
  const stale = progress?.live === false;
  const downloading = job.state === 'downloading';
  const tone =
    status.kind === 'ready' ? 'success' : job.state === 'paused' || job.state === 'error' ? 'warning' : 'accent';

  return (
    <li className={styles.row} data-testid={`job-${job.id}`} data-state={job.state}>
      <div className={styles.main}>
        <div className={styles.titleLine}>
          <Link to={`/downloads/${job.id}`} className={styles.title}>
            {job.target.title}
            {ep ? <span className={styles.ep}> {ep}</span> : null}
          </Link>
          <StatusBadge status={status} />
          {status.seeding ? <span className={styles.seedBadge}>{t('downloads.seeding')}</span> : null}
          <span className={styles.seedBadge} role="status">
            {subtitleSummary(job)}
          </span>
        </div>
        <p className={`mono ${styles.release}`} title={job.releaseName}>
          {job.releaseName}
        </p>
        <ProgressBar
          value={status.filesComplete ? 100 : percent}
          label={`${job.target.title}: ${percent === null ? '' : t('downloads.percent', { value: Math.floor(percent) })}`}
          tone={tone}
          stale={stale}
        />
        <div className={styles.stats} aria-live="off">
          <span className="mono">
            {percent === null
              ? '—'
              : t('downloads.percent', { value: Math.floor(status.filesComplete ? 100 : percent) })}
          </span>
          {total > 0 ? (
            <span>
              {t('downloads.progressOf', { done: formatBytes(done) ?? '0', total: formatBytes(total) ?? '?' })}
            </span>
          ) : null}
          {progress && (downloading || job.state === 'seeding') ? (
            <>
              <span className={styles.rate}>
                <ArrowDown size={11} aria-hidden /> {formatRate(progress.downloadRate)}
              </span>
              <span className={styles.rate}>
                <ArrowUp size={11} aria-hidden /> {formatRate(progress.uploadRate)}
              </span>
              <span className={styles.rate}>
                <Users size={11} aria-hidden /> {t('downloads.peers', { count: progress.peers })}
              </span>
            </>
          ) : null}
          {downloading && progress ? (
            <span>
              {progress.etaSeconds !== null
                ? t('downloads.eta', { value: formatDuration(progress.etaSeconds) })
                : progress.peers === 0
                  ? t('downloads.noPeers')
                  : t('downloads.etaUnknown')}
            </span>
          ) : null}
          {stale ? <span className={styles.stale}>{t('downloads.stale')}</span> : null}
        </div>
      </div>
      <div className={styles.actions}>
        {canPause ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pause.isPending}
            onClick={() => pause.mutate(job.id)}
            aria-label={`${t('downloads.pause')}: ${job.target.title}`}
          >
            <Pause size={13} aria-hidden /> {t('downloads.pause')}
          </Button>
        ) : null}
        {canResume ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={resume.isPending}
            onClick={() => resume.mutate(job.id)}
            aria-label={`${t('downloads.resume')}: ${job.target.title}`}
          >
            {job.state === 'error' ? <RotateCcw size={13} aria-hidden /> : <Play size={13} aria-hidden />}{' '}
            {job.state === 'error' ? t('downloads.retry') : t('downloads.resume')}
          </Button>
        ) : null}
        {canSkipSubtitles ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={subtitles.isPending}
            onClick={() => subtitles.mutate({ jobId: job.id, language: null, fallback: null })}
            aria-label={`${t('subtitles.skip')}: ${job.target.title}`}
            data-testid="job-skip-subtitles"
          >
            <SkipForward size={13} aria-hidden /> {t('subtitles.skip')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void openJobFolder(job.id).catch(() => undefined)}
          aria-label={`${t('downloads.openFolder')}: ${job.target.title}`}
        >
          <FolderOpen size={13} aria-hidden /> {t('downloads.openFolder')}
        </Button>
        <Link
          to={`/downloads/${job.id}`}
          className={styles.more}
          aria-label={`${t('downloads.details')}: ${job.target.title}`}
        >
          <Info size={13} aria-hidden /> {t('downloads.details')}
        </Link>
      </div>
    </li>
  );
}

function subtitleSummary(job: DownloadJob): string {
  if (!job.subtitleLang) return t('subtitles.state.disabled');
  const states = job.subtitles.filter((s) => s.state !== 'disabled').map((s) => t(`subtitles.state.${s.state}`));
  return states.length ? [...new Set(states)].join(' · ') : t('subtitles.state.pending');
}
