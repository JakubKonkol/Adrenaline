import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { DownloadJob, SubtitleTaskDto } from '@shared/contracts/downloads';
import { languageCodeSchema } from '@shared/contracts/settings';
import { LANGUAGE_CODES, languageName } from '@shared/domain/languages';
import { isAppErrorCode } from '@shared/errors';
import { api, ApiError, unwrap } from '../../api/bridge';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Field, Select } from '../../ui/Form';
import { Card } from '../../ui/Page';
import styles from './SubtitlePanel.module.css';

export function SubtitlePanel({ job }: { job: DownloadJob }) {
  const [language, setLanguage] = useState(job.subtitleLang ?? '');
  const [fallback, setFallback] = useState(job.subtitleFallbackLang ?? '');
  const change = useMutation({
    mutationFn: () =>
      unwrap(
        api().subtitles.language({
          jobId: job.id,
          language: language ? languageCodeSchema.parse(language) : null,
          fallback: fallback ? languageCodeSchema.parse(fallback) : null,
        }),
      ),
  });
  return (
    <Card>
      <h2>{t('subtitles.title')}</h2>
      <p>{t('subtitles.hint')}</p>
      <div className={styles.options}>
        <Field label={t('subtitles.language')}>
          {(a) => (
            <Select {...a} value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">{t('subtitles.state.disabled')}</option>
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
              {LANGUAGE_CODES.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          disabled={
            change.isPending || (language === (job.subtitleLang ?? '') && fallback === (job.subtitleFallbackLang ?? ''))
          }
          onClick={() => change.mutate()}
        >
          {t('subtitles.change')}
        </Button>
      </div>
      {change.error ? <ErrorNotice error={change.error} /> : null}
      <div aria-live="polite">
        {job.subtitles.length === 0 ? (
          <p>{t(job.subtitleLang ? 'subtitles.state.pending' : 'subtitles.state.disabled')}</p>
        ) : null}
      </div>
      {job.subtitles.map((task) => (
        <Task key={task.id} job={job} task={task} />
      ))}
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
        <p>{t('subtitles.reset', { date: new Date(task.quotaResetAt).toLocaleString('pl-PL') })}</p>
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
