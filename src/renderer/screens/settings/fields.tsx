import { ExternalLink, FolderOpen } from 'lucide-react';
import type { SecretsStatus, UserSecretName } from '@shared/contracts/settings';
import { SUBTITLE_LANGUAGES } from '@shared/domain/languages';
import { chooseFolder } from '../../api/settings';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { Field, Select, TextInput, Toggle } from '../../ui/Form';
import type { DraftErrors, SettingsDraft } from './draft';
import styles from './Settings.module.css';

export type DraftSetter = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void;

interface GroupProps {
  draft: SettingsDraft;
  set: DraftSetter;
  errors?: DraftErrors;
  onError?: (error: unknown) => void;
}

export const TMDB_KEY_URL = 'https://www.themoviedb.org/settings/api';
export const OPENSUBTITLES_KEY_URL = 'https://www.opensubtitles.com/consumers';

export function rangeError(errors: DraftErrors | undefined, key: keyof SettingsDraft): string | null {
  const r = errors?.[key];
  return r ? t('settings.rangeError', { min: r.min, max: r.max }) : null;
}

export function FolderField({ draft, set, onError }: GroupProps) {
  const pick = async () => {
    try {
      const folder = await chooseFolder(draft.downloadDir);
      if (folder) set('downloadDir', folder);
    } catch (error) {
      onError?.(error);
    }
  };
  return (
    <Field label={t('settings.download.folder')} hint={t('settings.download.folderHint')}>
      {(a) => (
        <div className={styles.folderRow}>
          <TextInput {...a} value={draft.downloadDir} readOnly className="mono" data-testid="download-dir" />
          <Button onClick={() => void pick()}>
            <FolderOpen size={14} aria-hidden />
            {t('common.change')}
          </Button>
        </div>
      )}
    </Field>
  );
}

export function SubtitleFields({ draft, set }: GroupProps) {
  return (
    <>
      <Toggle
        label={t('settings.subtitles.enabled')}
        description={t('settings.subtitles.enabledHint')}
        checked={draft.subtitlesEnabled}
        onChange={(v) => set('subtitlesEnabled', v)}
        testId="subtitles-enabled"
      />
      <Field label={t('settings.subtitles.lang')}>
        {(a) => (
          <Select
            {...a}
            value={draft.subtitleLang}
            disabled={!draft.subtitlesEnabled}
            data-testid="subtitle-lang"
            onChange={(e) => set('subtitleLang', e.target.value as SettingsDraft['subtitleLang'])}
          >
            {SUBTITLE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('settings.subtitles.fallback')} hint={t('settings.subtitles.fallbackHint')}>
        {(a) => (
          <Select
            {...a}
            value={draft.subtitleFallbackLang}
            disabled={!draft.subtitlesEnabled}
            onChange={(e) => set('subtitleFallbackLang', e.target.value as SettingsDraft['subtitleFallbackLang'])}
          >
            <option value="">{t('common.none')}</option>
            {SUBTITLE_LANGUAGES.filter((l) => l.code !== draft.subtitleLang).map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

function SecretInput({
  name,
  label,
  hint,
  draft,
  set,
  status,
  testId,
}: GroupProps & {
  name: UserSecretName;
  label: string;
  hint?: React.ReactNode;
  status?: SecretsStatus;
  testId?: string;
}) {
  const stored = status?.set[name] ?? false;
  return (
    <Field label={label} hint={hint}>
      {(a) => (
        <TextInput
          {...a}
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-testid={testId}
          placeholder={stored ? t('common.secretSet') : t('common.secretUnset')}
          value={draft.secrets[name]}
          onChange={(e) => set('secrets', { ...draft.secrets, [name]: e.target.value })}
        />
      )}
    </Field>
  );
}

function KeyLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.link}>
      {t('common.howToGet')} <ExternalLink size={11} aria-hidden />
    </a>
  );
}

export function TmdbField(props: GroupProps & { status?: SecretsStatus }) {
  return (
    <SecretInput
      {...props}
      name="tmdb.token"
      label={t('settings.accounts.tmdb')}
      testId="tmdb-token"
      hint={
        <>
          {t('settings.accounts.tmdbHint')} <KeyLink href={TMDB_KEY_URL} />
        </>
      }
    />
  );
}

export function OpenSubtitlesFields(props: GroupProps & { status?: SecretsStatus }) {
  const { draft, set } = props;
  return (
    <>
      <SecretInput
        {...props}
        name="opensubtitles.apiKey"
        label={t('settings.accounts.osApiKey')}
        hint={
          <>
            {t('settings.accounts.osHint')} <KeyLink href={OPENSUBTITLES_KEY_URL} />
          </>
        }
      />
      <Field label={t('settings.accounts.osUsername')}>
        {(a) => (
          <TextInput
            {...a}
            autoComplete="off"
            spellCheck={false}
            value={draft.opensubtitlesUsername}
            onChange={(e) => set('opensubtitlesUsername', e.target.value)}
          />
        )}
      </Field>
      <SecretInput {...props} name="opensubtitles.password" label={t('settings.accounts.osPassword')} />
    </>
  );
}
