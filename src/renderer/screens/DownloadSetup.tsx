import { AlertTriangle, ArrowLeft, Download, FolderOpen, Info } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { AppSettings } from '@shared/contracts/settings';
import { SUBTITLE_LANGUAGES, type LanguageCode } from '@shared/domain/languages';
import { searchTargetSchema } from '@shared/domain/search-target';
import { useCreateDownload, usePreflight } from '../api/downloads';
import { chooseFolder, useSettings, useSubtitleAccountReady } from '../api/settings';
import { formatBytes } from '../format';
import { t } from '../i18n/t';
import { Button } from '../ui/Button';
import { ErrorNotice } from '../ui/ErrorNotice';
import { Field, Section, Select, TextInput, Toggle } from '../ui/Form';
import { Card, Page } from '../ui/Page';
import styles from './DownloadSetup.module.css';

interface SetupState {
  target?: unknown;
  sessionId?: string;
  releaseId?: string;
  releaseName?: string;
}

export function DownloadSetup() {
  const location = useLocation();
  const state = (location.state ?? {}) as SetupState;
  const target = searchTargetSchema.safeParse(state.target);
  const { data: settings } = useSettings();
  const accountReady = useSubtitleAccountReady();
  if (!target.success || !state.sessionId || !state.releaseId || !settings || accountReady === undefined) {
    return (
      <Page label={t('downloadSetup.title')} title={t('downloadSetup.title')} testId="screen-download-setup">
        <Card>{t('downloadSetup.missing')}</Card>
      </Page>
    );
  }
  return (
    <SetupForm
      settings={settings}
      accountReady={accountReady}
      sessionId={state.sessionId}
      releaseId={state.releaseId}
      releaseName={state.releaseName ?? ''}
      back={{ target: target.data, sessionId: state.sessionId }}
    />
  );
}

function SetupForm({
  settings,
  accountReady,
  sessionId,
  releaseId,
  releaseName,
  back,
}: {
  settings: AppSettings;
  accountReady: boolean;
  sessionId: string;
  releaseId: string;
  releaseName: string;
  back: { target: unknown; sessionId: string };
}) {
  const navigate = useNavigate();
  const [saveDir, setSaveDir] = useState(settings.downloadDir);
  const [rename, setRename] = useState(false);
  // D-78: subtitles are asked for per download; pre-selected only when they can actually be downloaded.
  const [wantSubtitles, setWantSubtitles] = useState(settings.subtitlesEnabled && accountReady);
  const [lang, setLang] = useState<LanguageCode>(settings.subtitleLang);
  const [fallback, setFallback] = useState<LanguageCode | ''>(settings.subtitleFallbackLang ?? '');
  const [ratio, setRatio] = useState(settings.seedRatioLimit === null ? '' : String(settings.seedRatioLimit));
  const [minutes, setMinutes] = useState(settings.seedTimeLimitMin === null ? '' : String(settings.seedTimeLimitMin));
  const [folderError, setFolderError] = useState<unknown>(null);
  const ref = { sessionId, releaseId };
  const preflight = usePreflight(ref, { saveDir, renameOnConflict: rename });
  const create = useCreateDownload();
  const p = preflight.data;

  const parseNum = (v: string, int: boolean) => {
    const s = v.trim().replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? (int ? Math.round(n) : n) : null;
  };

  const blocked = !p || !p.writable || p.enoughSpace === false || p.folderExists || p.duplicateJobId !== null;

  const start = () => {
    create.mutate(
      {
        ref,
        options: {
          saveDir,
          subtitleLang: wantSubtitles ? lang : null,
          subtitleFallbackLang: wantSubtitles && fallback && fallback !== lang ? fallback : null,
          seedRatioLimit: parseNum(ratio, false),
          seedTimeLimitMin: parseNum(minutes, true),
          renameOnConflict: rename,
        },
      },
      { onSuccess: (job) => void navigate(`/downloads/${job.id}`, { replace: true }) },
    );
  };

  const pick = async () => {
    try {
      const folder = await chooseFolder(saveDir);
      if (folder) {
        setSaveDir(folder);
        setRename(false);
      }
    } catch (e) {
      setFolderError(e);
    }
  };

  return (
    <Page
      label={t('downloadSetup.title')}
      title={t('downloadSetup.title')}
      testId="screen-download-setup"
      actions={
        <>
          <Button variant="ghost" onClick={() => void navigate('/releases', { state: back })}>
            <ArrowLeft size={14} aria-hidden /> {t('common.back')}
          </Button>
          <Button variant="primary" disabled={blocked || create.isPending} onClick={start} data-testid="download-start">
            <Download size={14} aria-hidden />{' '}
            {create.isPending ? t('downloadSetup.starting') : t('downloadSetup.download')}
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <Card>
          <p className="label">{t('downloadSetup.chosen')}</p>
          <p className={`mono ${styles.release}`}>{releaseName}</p>
          <p className={styles.note}>
            <Info size={13} aria-hidden /> {t('downloadSetup.magnetFiles')}
          </p>
        </Card>

        {create.error ? <ErrorNotice error={create.error} /> : null}
        {preflight.error ? <ErrorNotice error={preflight.error} /> : null}

        <Section title={t('downloadSetup.folder')}>
          <Field label={t('downloadSetup.folder')}>
            {(a) => (
              <div className={styles.folderRow}>
                <TextInput {...a} value={saveDir} readOnly className="mono" />
                <Button onClick={() => void pick()}>
                  <FolderOpen size={14} aria-hidden /> {t('common.change')}
                </Button>
              </div>
            )}
          </Field>
          {folderError ? <ErrorNotice error={folderError} compact /> : null}
          {p ? (
            <div className={styles.checks} data-testid="download-checks">
              <p className={`mono ${styles.path}`}>{p.folder}</p>
              {p.requiredBytes !== null && p.freeBytes !== null ? (
                <p className={p.enoughSpace ? styles.ok : styles.bad}>
                  {t('downloadSetup.space', {
                    free: formatBytes(p.freeBytes) ?? '?',
                    required: formatBytes(p.requiredBytes) ?? '?',
                  })}
                </p>
              ) : (
                <p className={styles.muted}>{t('downloadSetup.spaceUnknown')}</p>
              )}
              {p.enoughSpace === false ? <Warn text={t('downloadSetup.notEnoughSpace')} bad /> : null}
              {!p.writable ? <Warn text={t('downloadSetup.notWritable')} bad /> : null}
              {p.pathTooLong ? <Warn text={t('downloadSetup.pathTooLong')} /> : null}
              {p.folderExists ? (
                <div className={styles.conflict}>
                  <Warn text={t('downloadSetup.exists')} bad />
                  <Button size="sm" onClick={() => setRename(true)}>
                    {t('downloadSetup.useOtherName')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void pick()}>
                    {t('common.change')}
                  </Button>
                </div>
              ) : null}
              {p.duplicateJobId ? (
                <div className={styles.conflict}>
                  <Warn text={t('downloadSetup.duplicate')} bad />
                  <Link to={`/downloads/${p.duplicateJobId}`}>{t('downloadSetup.goToJob')}</Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title={t('downloadSetup.subtitles')} description={t('downloadSetup.subtitlesHint')}>
          <Toggle
            label={t('downloadSetup.subtitlesEnabled')}
            checked={wantSubtitles}
            onChange={setWantSubtitles}
            testId="download-sub-enabled"
          />
          {wantSubtitles && !accountReady ? (
            <div className={styles.conflict} data-testid="download-sub-no-account">
              <Warn text={t('subtitles.noAccount')} />
              <Link to="/settings">{t('subtitles.noAccountAction')}</Link>
            </div>
          ) : null}
          {wantSubtitles ? (
            <>
              <Field label={t('downloadSetup.subtitleLang')}>
                {(a) => (
                  <Select
                    {...a}
                    value={lang}
                    onChange={(e) => setLang(e.target.value as LanguageCode)}
                    data-testid="download-sub-lang"
                  >
                    {SUBTITLE_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('downloadSetup.fallback')} hint={t('settings.subtitles.fallbackHint')}>
                {(a) => (
                  <Select {...a} value={fallback} onChange={(e) => setFallback(e.target.value as LanguageCode | '')}>
                    <option value="">{t('common.none')}</option>
                    {SUBTITLE_LANGUAGES.filter((l) => l.code !== lang).map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          ) : null}
        </Section>

        <Section title={t('downloadSetup.seeding')} description={t('downloadSetup.seedingHint')}>
          <Field label={t('settings.transfer.seedRatio')} hint={t('settings.transfer.emptyNoLimit')}>
            {(a) => (
              <TextInput
                {...a}
                className={styles.narrow}
                inputMode="decimal"
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('settings.transfer.seedMinutes')} hint={t('settings.transfer.emptyNoLimit')}>
            {(a) => (
              <TextInput
                {...a}
                className={styles.narrow}
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            )}
          </Field>
        </Section>
      </div>
    </Page>
  );
}

function Warn({ text, bad }: { text: string; bad?: boolean }) {
  return (
    <p className={bad ? styles.bad : styles.warn}>
      <AlertTriangle size={13} aria-hidden /> {text}
    </p>
  );
}
