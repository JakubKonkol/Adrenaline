import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Captions, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DownloadJob, SubtitleTaskDto } from '@shared/contracts/downloads';
import { languageCodeSchema } from '@shared/contracts/settings';
import { LANGUAGE_CODES, languageName } from '@shared/domain/languages';
import { isAppErrorCode } from '@shared/errors';
import { api, ApiError, unwrap } from '../../api/bridge';
import { useSetSubtitles } from '../../api/downloads';
import { useSettings, useSubtitleAccountReady } from '../../api/settings';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Field, Select } from '../../ui/Form';
import { Card } from '../../ui/Page';
import styles from './SubtitlePanel.module.css';

export function SubtitlePanel({ job }: { job: DownloadJob }) {
  const { data: settings } = useSettings();
  const accountReady = useSubtitleAccountReady();
  const enabled = job.subtitleLang !== null;
  const [language, setLanguage] = useState(job.subtitleLang ?? settings?.subtitleLang ?? 'en');
  const [fallback, setFallback] = useState(job.subtitleFallbackLang ?? '');
  const change = useSetSubtitles();
  const apply = (lang: string | null) =>
    change.mutate({
      jobId: job.id,
      language: lang ? languageCodeSchema.parse(lang) : null,
      fallback: lang && fallback && fallback !== lang ? languageCodeSchema.parse(fallback) : null,
    });
  const unchanged = language === (job.subtitleLang ?? '') && fallback === (job.subtitleFallbackLang ?? '');
  return (
    <Card>
      <div className={styles.header}>
        <h2>{t('subtitles.title')}</h2>
        {enabled ? (
          <Button variant="ghost" disabled={change.isPending} onClick={() => apply(null)} data-testid="subtitles-skip">
            <SkipForward size={14} aria-hidden /> {change.isPending ? t('subtitles.skipping') : t('subtitles.skip')}
          </Button>
        ) : null}
      </div>
      <p>{enabled ? t('subtitles.hint') : t('subtitles.off')}</p>
      {accountReady === false ? (
        <p className={styles.warn} data-testid="subtitles-no-account">
          <AlertTriangle size={13} aria-hidden /> {t('subtitles.noAccount')}{' '}
          <Link to="/settings">{t('subtitles.noAccountAction')}</Link>
        </p>
      ) : null}
      <div className={styles.options}>
        <Field label={t('subtitles.language')}>
          {(a) => (
            <Select {...a} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGE_CODES.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('subtitles.fallback')}>
          {(a) => (
            <Select {...a} value={fallback} onChange={(e) => setFallback(e.target.value)}>
              <option value="">{t('subtitles.noFallback')}</option>
              {LANGUAGE_CODES.filter((l) => l !== language).map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {enabled ? (
          <Button disabled={change.isPending || unchanged} onClick={() => apply(language)}>
            {t('subtitles.change')}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={change.isPending}
            onClick={() => apply(language)}
            data-testid="subtitles-get"
          >
            <Captions size={14} aria-hidden /> {change.isPending ? t('subtitles.getting') : t('subtitles.get')}
          </Button>
        )}
      </div>
      {change.error ? <ErrorNotice error={change.error} /> : null}
      <div aria-live="polite">
        {enabled && job.subtitles.every((s) => s.state === 'disabled') ? <p>{t('subtitles.state.pending')}</p> : null}
      </div>
      {enabled
        ? job.subtitles
            .filter((task) => task.state !== 'disabled')
            .map((task) => <Task key={task.id} job={job} task={task} />)
        : null}
      <p>{t('subtitles.attribution')}</p>
    </Card>
  );
}

function Task({ job, task }: { job: DownloadJob; task: SubtitleTaskDto }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!task.quotaResetAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.quotaResetAt]);
  const retry = useMutation({ mutationFn: () => unwrap(api().subtitles.retry({ jobId: job.id, taskId: task.id })) });
  const choose = useMutation({
    mutationFn: (fileId: number) => unwrap(api().subtitles.choose({ jobId: job.id, taskId: task.id, fileId })),
  });
  const busy =
    retry.isPending || choose.isPending || ['searching', 'downloading', 'pending', 'disabled'].includes(task.state);
  const quota = task.quotaResetAt !== null && task.quotaResetAt > now;
  return (
    <section className={styles.task}>
      <h3 className="mono">{job.files.find((f) => f.index === task.fileIndex)?.path}</h3>
      <p role="status">
        {languageName(task.lang)} · {t(`subtitles.state.${task.state}`)}
      </p>
      {task.quotaResetAt ? (
        <p>{t('subtitles.reset', { date: new Date(task.quotaResetAt).toLocaleString('en-US') })}</p>
      ) : null}
      {task.targetPath && task.state === 'ready' ? <p className="mono">{task.targetPath}</p> : null}
      {task.errorCode && isAppErrorCode(task.errorCode) ? (
        <ErrorNotice compact error={new ApiError({ code: task.errorCode, message: '' })} />
      ) : null}
      <Button disabled={busy || quota} onClick={() => retry.mutate()}>
        {t('subtitles.retry')}
      </Button>
      {retry.error || choose.error ? <ErrorNotice error={retry.error ?? choose.error} /> : null}
      {task.candidates.length ? (
        <details open={task.state === 'needs_selection'}>
          <summary>{t('subtitles.candidates', { count: task.candidates.length })}</summary>
          <ul className={styles.candidates}>
            {task.candidates.map((c) => (
              <li key={c.fileId}>
                <span className="mono">{c.release || c.fileName}</span>
                <span>
                  {t(`subtitles.confidence.${c.confidence}`)} · {languageName(c.language)} ·{' '}
                  {t('subtitles.popularity', { downloads: c.downloadCount, rating: c.ratings })}
                </span>
                <span>
                  {[
                    c.hearingImpaired ? t('subtitles.sdh') : '',
                    c.foreignPartsOnly ? t('subtitles.forced') : '',
                    c.machineTranslated ? t('subtitles.machine') : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <Button disabled={busy || quota} onClick={() => choose.mutate(c.fileId)}>
                  {t('subtitles.choose')}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
