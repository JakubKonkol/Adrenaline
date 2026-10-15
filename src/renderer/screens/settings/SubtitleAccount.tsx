import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../api/bridge';
import { t } from '../../i18n/t';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';

export function SubtitleAccount({ unsaved }: { unsaved: boolean }) {
  const qc = useQueryClient();
  const test = useMutation({ mutationFn: () => unwrap(api().settings.testSubtitles()) });
  const logout = useMutation({
    mutationFn: () => unwrap(api().settings.logoutSubtitles()),
    onSuccess: () => {
      test.reset();
      void qc.invalidateQueries({ queryKey: ['settings', 'secrets'] });
    },
  });
  const busy = test.isPending || logout.isPending;
  return (
    <div>
      <p>{t('subtitles.accountHint')}</p>
      <Button disabled={busy || unsaved} onClick={() => test.mutate()}>
        {t('subtitles.test')}
      </Button>{' '}
      <Button disabled={busy} onClick={() => logout.mutate()}>
        {t('subtitles.logout')}
      </Button>
      {test.data && !unsaved ? (
        <p role="status">
          {t('subtitles.limits', {
            remaining: test.data.remaining ?? '?',
            allowed: test.data.allowed ?? '?',
            level: test.data.level ?? '',
          })}
        </p>
      ) : null}
      {logout.isSuccess ? <p role="status">{t('subtitles.loggedOut')}</p> : null}
      {test.error || logout.error ? <ErrorNotice error={test.error ?? logout.error} /> : null}
    </div>
  );
}
