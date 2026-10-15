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

/** Whether an OpenSubtitles account is fully saved (API key, username, password); undefined while loading. */
export function useSubtitleAccountReady(): boolean | undefined {
  const { data: settings } = useSettings();
  const { data: secrets } = useSecretsStatus();
  if (!settings || !secrets) return undefined;
  return (
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
