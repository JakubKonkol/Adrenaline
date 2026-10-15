import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { AppSettings, SecretsStatus } from '@shared/contracts/settings';
import markDark from '../../assets/brand/adrenaline-mark-on-dark.svg';
import markLight from '../../assets/brand/adrenaline-mark-on-light.svg';
import { useSecretsStatus, useSetSecret, useSettings, useUpdateSettings } from '../../api/settings';
import { TitleBar } from '../../components/TitleBar';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { changedSecrets, fromDraft, type SettingsDraft, toDraft } from '../settings/draft';
import { type DraftSetter, FolderField, OpenSubtitlesFields, SubtitleFields, TmdbField } from '../settings/fields';
import { BuiltinSources } from '../settings/SourcesSection';
import styles from './Onboarding.module.css';

const STEPS = ['welcome', 'folder', 'subtitles', 'tmdb', 'opensubtitles', 'sources', 'done'] as const;
type Step = (typeof STEPS)[number];

export function Onboarding() {
  const { data: settings } = useSettings();
  const { data: secrets } = useSecretsStatus();
  if (!settings || !secrets) return null;
  return <Wizard settings={settings} secrets={secrets} />;
}

function Wizard({ settings, secrets }: { settings: AppSettings; secrets: SecretsStatus }) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [error, setError] = useState<unknown>(null);
  const update = useUpdateSettings();
  const setSecret = useSetSecret();
  const navigate = useNavigate();
  const step: Step = STEPS[index] ?? 'welcome';
  const set: DraftSetter = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const group = { draft, set, onError: setError, status: secrets };

  /** Saves what the current step changed, then moves on (each step is saved, so quitting midway keeps it). */
  const next = async () => {
    setError(null);
    try {
      if (step !== 'welcome') {
        await update.mutateAsync(fromDraft(draft).patch);
        for (const s of changedSecrets(draft)) await setSecret.mutateAsync(s);
      }
      if (step === 'done') {
        await update.mutateAsync({ onboardingDone: true });
        void navigate('/', { replace: true });
        return;
      }
      setIndex((i) => Math.min(i + 1, STEPS.length - 1));
    } catch (e) {
      setError(e);
    }
  };

  const busy = update.isPending || setSecret.isPending;
  const tmdbMissing = !secrets.set['tmdb.token'] && draft.secrets['tmdb.token'].trim() === '';
  const optional = step === 'opensubtitles' || step === 'sources';

  return (
    <div className={styles.shell}>
      <TitleBar />
      <main className={styles.main} data-testid="screen-onboarding">
        <div className={styles.card}>
          {step !== 'welcome' && step !== 'done' ? (
            <p className="label">{t('onboarding.step', { current: index, total: STEPS.length - 2 })}</p>
          ) : null}

          {step === 'welcome' ? (
            <div className={styles.hero}>
              <picture>
                <source srcSet={markLight} media="(prefers-color-scheme: light)" />
                <img className={styles.logo} src={markDark} alt="" aria-hidden />
              </picture>
              <h1 className={styles.title}>{t('onboarding.welcome.title')}</h1>
              <p className={styles.body}>{t('onboarding.welcome.body')}</p>
            </div>
          ) : null}

          {step === 'folder' ? (
            <>
              <h1 className={styles.title}>{t('onboarding.folder.title')}</h1>
              <FolderField {...group} />
            </>
          ) : null}

          {step === 'subtitles' ? (
            <>
              <h1 className={styles.title}>{t('onboarding.subtitles.title')}</h1>
              <SubtitleFields {...group} />
            </>
          ) : null}

          {step === 'tmdb' ? (
            <>
              <h1 className={styles.title}>{t('onboarding.tmdb.title')}</h1>
              <p className={styles.body}>{t('onboarding.tmdb.body')}</p>
              <TmdbField {...group} />
              {tmdbMissing ? <p className={styles.note}>{t('onboarding.tmdb.missing')}</p> : null}
            </>
          ) : null}

          {step === 'opensubtitles' ? (
            <>
              <h1 className={styles.title}>{t('onboarding.opensubtitles.title')}</h1>
              <p className={styles.body}>{t('onboarding.opensubtitles.body')}</p>
              <OpenSubtitlesFields {...group} />
            </>
          ) : null}

          {step === 'sources' ? (
            <>
              <h1 className={styles.title}>{t('sources.onboardingTitle')}</h1>
              <p className={styles.body}>{t('sources.onboardingBody')}</p>
              <BuiltinSources compact />
            </>
          ) : null}

          {step === 'done' ? (
            <div className={styles.hero}>
              <div className={styles.doneIcon} aria-hidden>
                <Check size={22} />
              </div>
              <h1 className={styles.title}>{t('onboarding.done.title')}</h1>
              <p className={styles.body}>{t('onboarding.done.body')}</p>
            </div>
          ) : null}

          {error ? <ErrorNotice error={error} /> : null}

          <div className={styles.actions}>
            {index > 0 && step !== 'done' ? (
              <Button variant="ghost" onClick={() => setIndex((i) => i - 1)}>
                <ArrowLeft size={14} aria-hidden />
                {t('common.back')}
              </Button>
            ) : (
              <span />
            )}
            <div className={styles.right}>
              {optional ? (
                <Button variant="ghost" onClick={() => setIndex((i) => i + 1)} data-testid="onboarding-skip">
                  {t('common.skip')}
                </Button>
              ) : null}
              <Button variant="primary" disabled={busy} onClick={() => void next()} data-testid="onboarding-next">
                {step === 'welcome'
                  ? t('onboarding.welcome.start')
                  : step === 'done'
                    ? t('onboarding.done.finish')
                    : t('common.next')}
                {step === 'done' ? null : <ArrowRight size={14} aria-hidden />}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
