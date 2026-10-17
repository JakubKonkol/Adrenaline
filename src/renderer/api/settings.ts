import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings, SecretsStatus, SettingsPatch, UserSecretName } from '@shared/contracts/settings';
import { api, unwrap } from './bridge';

const SETTINGS = ['settings'] as const;
const SECRETS = ['settings', 'secrets'] as const;

export function useSettings() {
  return useQuery({ queryKey: SETTINGS, queryFn: () => unwrap(api().settings.get()), staleTime: Infinity });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => unwrap(api().settings.update(patch)),
    onSuccess: (s) => qc.setQueryData<AppSettings>(SETTINGS, s),
  });
}

export function useSecretsStatus() {
  return useQuery({ queryKey: SECRETS, queryFn: () => unwrap(api().settings.secretsStatus()), staleTime: Infinity });
}

/** At least one enabled provider supports the configured languages. */
export function useSubtitleAccountReady(): boolean | undefined {
  const { data: settings } = useSettings();
  const { data: secrets, isError } = useSecretsStatus();
  if (!settings) return undefined;
  // Unknown secrets status (IPC error) counts as "no account": subtitles then start switched off.
  if (!secrets) return isError ? false : undefined;
  const polish = settings.subtitleLang === 'pl' || settings.subtitleFallbackLang === 'pl';
  if (polish && settings.subtitleProviders.includes('napiprojekt')) return true;
  if (
    polish &&
    settings.subtitleProviders.includes('napisy24') &&
    settings.napisy24Username.trim() &&
    secrets.set['napisy24.password']
  )
    return true;
  return (
    settings.subtitleProviders.includes('opensubtitles') &&
    settings.opensubtitlesUsername.trim() !== '' &&
    secrets.set['opensubtitles.apiKey'] === true &&
    secrets.set['opensubtitles.password'] === true
  );
}

export function useSetSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: UserSecretName; value: string | null }) => unwrap(api().settings.setSecret(input)),
    onSuccess: (s, input) => {
      qc.setQueryData<SecretsStatus>(SECRETS, s);
      if (input.name === 'tmdb.token') qc.removeQueries({ queryKey: ['catalog'] });
    },
  });
}

export function chooseFolder(defaultPath?: string): Promise<string | null> {
  return unwrap(api().settings.chooseFolder(defaultPath ? { defaultPath } : {}));
}
