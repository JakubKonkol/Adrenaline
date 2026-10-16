import { AlertTriangle, ArrowLeft, FolderOpen, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DownloadJob } from '@shared/contracts/downloads';
import { languageName } from '@shared/domain/languages';
import { ApiError } from '../../api/bridge';
import {
  openJobFolder,
  useDownload,
  useJobProgress,
  usePause,
  useRecheck,
  useRemove,
  useResume,
  useSelectFiles,
} from '../../api/downloads';
import { formatBytes } from '../../format';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Card, Page } from '../../ui/Page';
import { ProgressBar } from '../../ui/ProgressBar';
import { StatusBadge } from './StatusBadge';
import { episodeLabel, jobView } from './job-view';
import styles from './JobDetails.module.css';
import { SubtitlePanel } from './SubtitlePanel';

export function JobDetails() {
  const { jobId = '' } = useParams();
  const { data: job, error } = useDownload(jobId);
  if (error) {
    return (
      <Page label={t('nav.downloads')} title={t('downloads.details')} testId="screen-job">
        <ErrorNotice error={error} />
        <Link to="/downloads">{t('common.back')}</Link>
      </Page>
    );
  }
  if (!job) return null;
  return <Details job={job} />;
}

function Details({ job }: { job: DownloadJob }) {
  const navigate = useNavigate();
  const progress = useJobProgress(job.id);
  const { status, files, total, done, percent } = jobView(job, progress);
  const pause = usePause();
  const resume = useResume();
  const recheck = useRecheck();
  const remove = useRemove();
  const [actionError, setActionError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const ep = episodeLabel(job);
  const onError = { onError: setActionError };
  // D-80: a finished download has left the engine; only the folder and removal remain.
  const completed = job.state === 'completed';

  return (
    <Page
      label={t('nav.downloads')}
      title={`${job.target.title}${ep ? ` · ${ep}` : ''}`}
      testId="screen-job"
      actions={
        <Button variant="ghost" onClick={() => void navigate('/downloads')}>
          <ArrowLeft size={14} aria-hidden /> {t('common.back')}
        </Button>
      }
    >
      <Card className={styles.summary}>
        <div className={styles.statusLine}>
          <StatusBadge status={status} />
          {status.seeding ? (
            <span className={styles.muted}>
              {t('downloads.seedingInfo', { ratio: (progress?.ratio ?? 0).toFixed(2) })}
            </span>
          ) : null}
        </div>
        <p className={`mono ${styles.release}`}>{job.releaseName}</p>
        <ProgressBar
          value={status.filesComplete ? 100 : percent}
          label={job.target.title}
          stale={progress?.live === false}
        />
        <p className={styles.muted}>
          {total > 0
            ? t('downloads.progressOf', { done: formatBytes(done) ?? '0', total: formatBytes(total) ?? '?' })
            : null}
          {job.state === 'fetching_metadata' ? ` ${t('downloads.metadataWait')}` : null}
        </p>
        {job.errorCode ? (
          <ErrorNotice error={new ApiError({ code: job.errorCode as never, message: '' })} compact />
        ) : null}
        {actionError ? <ErrorNotice error={actionError} compact /> : null}
        <div className={styles.actions}>
          {completed ? null : ['paused', 'error', 'stopped'].includes(job.state) ? (
            <Button variant="primary" onClick={() => resume.mutate(job.id, onError)} disabled={resume.isPending}>
              <Play size={13} aria-hidden /> {job.state === 'error' ? t('downloads.retry') : t('downloads.resume')}
            </Button>
          ) : (
            <Button onClick={() => pause.mutate(job.id, onError)} disabled={pause.isPending}>
              <Pause size={13} aria-hidden /> {t('downloads.pause')}
            </Button>
          )}
          <Button onClick={() => void openJobFolder(job.id).catch(setActionError)}>
            <FolderOpen size={13} aria-hidden /> {t('downloads.openFolder')}
          </Button>
          {job.files.length > 0 && !completed ? (
            <Button variant="ghost" onClick={() => recheck.mutate(job.id, onError)} disabled={recheck.isPending}>
              <RefreshCw size={13} aria-hidden /> {t('downloads.recheck')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setConfirm(true)} data-testid="job-remove">
            <Trash2 size={13} aria-hidden /> {t('downloads.remove')}
          </Button>
        </div>
      </Card>

      {job.state === 'awaiting_file_selection' ? <FileChooser job={job} /> : null}

      <section>
        <h2 className="label">{t('downloads.files')}</h2>
        <ul className={styles.files}>
          {files.map((f) => (
            <li key={f.index} className={f.selected ? '' : styles.unselected}>
              <span className={`mono ${styles.filePath}`} title={f.path}>
                {f.path}
              </span>
              <span className={styles.fileMeta}>
                {f.kind === 'executable' ? (
                  <span className={styles.danger}>
                    <AlertTriangle size={11} aria-hidden /> {t('downloads.fileKind.executable')}
                  </span>
                ) : (
                  t(`downloads.fileKind.${f.kind}`)
                )}{' '}
                · {formatBytes(f.size)}
                {f.selected ? ` · ${Math.floor((f.doneBytes / Math.max(1, f.size)) * 100)}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <dl className={styles.facts}>
          <dt className="label">{t('downloads.saveDir')}</dt>
          <dd className="mono">{job.saveDir}</dd>
          <dt className="label">{t('downloads.subtitlesLang')}</dt>
          <dd>
            {job.subtitleLang
              ? `${languageName(job.subtitleLang)}${job.subtitleFallbackLang ? ` → ${languageName(job.subtitleFallbackLang)}` : ''}`
              : t('downloads.noSubtitles')}
          </dd>
          <dt className="label">{t('downloads.sources')}</dt>
          <dd>{job.sources.join(', ')}</dd>
        </dl>
        <details className={styles.technical}>
          <summary>{t('downloads.technical')}</summary>
          <p className="mono">
            {t('downloads.infoHash')}: {job.infoHashV1 ?? '—'}
            {job.infoHashV2 ? ` / ${job.infoHashV2}` : ''}
          </p>
        </details>
      </Card>

      <SubtitlePanel key={`${job.id}:${job.subtitleLang}:${job.subtitleFallbackLang}`} job={job} />
      <Dialog
        open={confirm}
        title={t('downloads.removeTitle')}
        onClose={() => setConfirm(false)}
        testId="remove-dialog"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { jobId: job.id, deleteFiles },
                  { onSuccess: () => void navigate('/downloads'), onError: setActionError },
                )
              }
            >
              {t('downloads.removeConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('downloads.removeBody')}</p>
        <label className={styles.check}>
          <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
          {t('downloads.removeFiles')}
        </label>
        {deleteFiles ? (
          <>
            <p>{t('downloads.removeFilesList')}</p>
            <ul className={`mono ${styles.removeList}`}>
              {job.files
                .filter((f) => f.selected)
                .map((f) => (
                  <li key={f.index}>{f.path}</li>
                ))}
            </ul>
          </>
        ) : null}
      </Dialog>
    </Page>
  );
}

/** FR09: the user picks the files; executables are never pre-selected. */
function FileChooser({ job }: { job: DownloadJob }) {
  const [chosen, setChosen] = useState<number[]>(job.suggestedFiles);
  const select = useSelectFiles();
  const toggle = (i: number) => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  return (
    <Card className={styles.chooser}>
      <h2 className={styles.chooserTitle}>{t('downloads.chooseFiles')}</h2>
      <p className={styles.muted}>{t('downloads.chooseFilesBody')}</p>
      <ul className={styles.choices} data-testid="file-chooser">
        {job.files.map((f) => (
          <li key={f.index}>
            <label className={styles.check}>
              <input type="checkbox" checked={chosen.includes(f.index)} onChange={() => toggle(f.index)} />
              <span className="mono">{f.path}</span>
              <span className={f.kind === 'executable' ? styles.danger : styles.muted}>
                {t(`downloads.fileKind.${f.kind}`)} · {formatBytes(f.size)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {select.error ? <ErrorNotice error={select.error} compact /> : null}
      <div>
        <Button
          variant="primary"
          disabled={chosen.length === 0 || select.isPending}
          onClick={() => select.mutate({ jobId: job.id, indices: chosen })}
        >
          {t('downloads.chooseFilesConfirm')}
        </Button>
      </div>
    </Card>
  );
}
