import { Check, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppSettings } from '@shared/contracts/settings';
import { useSecretsStatus, useSetSecret, useSettings, useUpdateSettings } from '../../api/settings';
import { useTestTmdb } from '../../api/catalog';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Field, Section, Select, TextInput, Toggle } from '../../ui/Form';
import { Page } from '../../ui/Page';
import { changedSecrets, type DraftErrors, fromDraft, type SettingsDraft, toDraft } from './draft';
import {
  type DraftSetter,
  FolderField,
  OpenSubtitlesFields,
  Napisy24Fields,
  rangeError,
  SubtitleFields,
  TmdbField,
} from './fields';
import { SUBTITLE_PROVIDERS, type SubtitleProvider } from '@shared/contracts/subtitles';
import styles from './Settings.module.css';
import { SourcesSection } from './SourcesSection';
import { SubtitleAccount } from './SubtitleAccount';

export function SettingsScreen() {
  const { data: settings } = useSettings();
  if (!settings) return null;
  return <SettingsForm settings={settings} />;
}

function NumberField({
  label,
  hint,
  field,
  draft,
  set,
  errors,
}: {
  label: string;
  hint?: string;
  field: keyof SettingsDraft;
  draft: SettingsDraft;
  set: DraftSetter;
  errors: DraftErrors;
}) {
  return (
    <Field label={label} hint={hint} error={rangeError(errors, field)}>
      {(a) => (
        <TextInput
          {...a}
          inputMode="decimal"
          className={styles.narrow}
          value={draft[field] as string}
          data-testid={`setting-${field}`}
          onChange={(e) => set(field, e.target.value as never)}
        />
      )}
    </Field>
  );
}

function SettingsForm({ settings }: { settings: AppSettings }) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const update = useUpdateSettings();
  const setSecret = useSetSecret();
  const { data: secrets } = useSecretsStatus();
  const testTmdb = useTestTmdb();

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  const set: DraftSetter = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
    if (key === 'secrets') testTmdb.reset();
  };

  const save = async () => {
    const { patch, errors: errs } = fromDraft(draft);
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length > 0) return;
    try {
      await update.mutateAsync(patch);
      for (const s of changedSecrets(draft)) await setSecret.mutateAsync(s);
      setDraft((d) => ({
        ...d,
        secrets: {
          'tmdb.token': '',
          'opensubtitles.apiKey': '',
          'opensubtitles.password': '',
          'napisy24.password': '',
        },
      }));
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  const busy = update.isPending || setSecret.isPending;
  const group = { draft, set, errors, onError: setError };

  return (
    <Page
      label={t('nav.settings')}
      title={t('settings.title')}
      testId="screen-settings"
      actions={
        <div className={styles.saveBar}>
          {saved ? (
            <span className={styles.savedText} role="status">
              <Check size={12} aria-hidden /> {t('common.saved')}
            </span>
          ) : null}
          <Button variant="primary" disabled={busy} onClick={() => void save()} data-testid="settings-save">
            <Save size={14} aria-hidden />
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      }
    >
      <div className={styles.sections}>
        {error ? <ErrorNotice error={error} /> : null}
        {Object.keys(errors).length > 0 ? (
          <p className={styles.warning} role="alert">
            {t('settings.invalid')}
          </p>
        ) : null}

        <Section title={t('settings.download.title')}>
          <FolderField {...group} />
          <NumberField label={t('settings.download.maxActive')} field="maxActiveDownloads" {...group} />
        </Section>

        <Section title={t('settings.subtitles.title')}>
          <SubtitleFields {...group} />
          {(Object.entries(SUBTITLE_PROVIDERS) as [SubtitleProvider, string][]).map(([provider, label]) => (
            <Toggle
              key={provider}
              label={label}
              description={provider === 'napiprojekt' ? t('subtitles.napiHint') : undefined}
              checked={draft.subtitleProviders.includes(provider)}
              onChange={(on) =>
                set(
                  'subtitleProviders',
                  on ? [...draft.subtitleProviders, provider] : draft.subtitleProviders.filter((p) => p !== provider),
                )
              }
            />
          ))}
        </Section>

        <Section title={t('settings.transfer.title')} description={t('settings.transfer.seedingHint')}>
          <NumberField
            label={t('settings.transfer.downloadLimit')}
            hint={t('settings.transfer.limitHint')}
            field="downloadLimitKBps"
            {...group}
          />
          <NumberField
            label={t('settings.transfer.uploadLimit')}
            hint={t('settings.transfer.limitHint')}
            field="uploadLimitKBps"
            {...group}
          />
          <NumberField label={t('settings.transfer.port')} field="listenPort" {...group} />
        </Section>

        <Section title={t('settings.accounts.title')} description={t('settings.accounts.description')}>
          {secrets && !secrets.encryptionAvailable ? (
            <p className={styles.warning}>{t('settings.accounts.noEncryption')}</p>
          ) : null}
          <TmdbField {...group} {...(secrets ? { status: secrets } : {})} />
          <p>{t('catalog.testKeyHint')}</p>
          <Button
            disabled={busy || testTmdb.isPending || !!draft.secrets['tmdb.token'].trim()}
            onClick={() => testTmdb.mutate()}
          >
            {t(testTmdb.isPending ? 'app.loading' : 'catalog.testKey')}
          </Button>
          {testTmdb.isSuccess ? <p role="status">{t('catalog.testSuccess')}</p> : null}
          {testTmdb.error ? <ErrorNotice error={testTmdb.error} /> : null}
          <OpenSubtitlesFields {...group} {...(secrets ? { status: secrets } : {})} />
          <SubtitleAccount
            unsaved={
              !!draft.secrets['opensubtitles.apiKey'] ||
              !!draft.secrets['opensubtitles.password'] ||
              draft.opensubtitlesUsername !== settings.opensubtitlesUsername
            }
          />
          <Napisy24Fields {...group} {...(secrets ? { status: secrets } : {})} />
        </Section>

        <Section title={t('settings.sources.title')}>
          <SourcesSection />
        </Section>

        <Section title={t('settings.app.title')}>
          <Toggle
            label={t('settings.app.closeToTray')}
            description={t('settings.app.closeToTrayHint')}
            checked={draft.closeToTray}
            onChange={(v) => set('closeToTray', v)}
          />
          <Field label={t('settings.app.theme')}>
            {(a) => (
              <Select
                {...a}
                value={draft.theme}
                onChange={(e) => set('theme', e.target.value as SettingsDraft['theme'])}
              >
                <option value="system">{t('settings.app.themeSystem')}</option>
                <option value="dark">{t('settings.app.themeDark')}</option>
                <option value="light">{t('settings.app.themeLight')}</option>
              </Select>
            )}
          </Field>
          <Toggle
            label={t('settings.app.beta')}
            description={t('settings.app.betaHint')}
            checked={draft.betaUpdates}
            onChange={(v) => set('betaUpdates', v)}
          />
        </Section>
      </div>
    </Page>
  );
}
