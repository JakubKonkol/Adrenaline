import { t } from '../i18n';
import { platform } from '../platform';
import { useSession } from '../session';
import { Button } from '../ui';
import tmdbLogo from '../assets/tmdb.svg';

export function Settings() {
  const { api, session, disconnect } = useSession();
  const rows: [string, string][] = [
    [t('settings.pc'), `${session.server.serverName} · ${api.base.replace(/^https?:\/\//, '')}`],
    [t('settings.device'), `${session.device.name} (${platform.name})`],
    [t('settings.version'), `${__TV_VERSION__} · PC ${session.server.version}`],
  ];
  return (
    <div className="screen settings" data-page="">
      <header className="screen-header">
        <h1>{t('settings.title')}</h1>
      </header>
      <dl className="facts">
        {rows.map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="actions">
        <Button autoFocus focusKey="settings-disconnect" onSelect={() => disconnect()}>
          {t('settings.disconnect')}
        </Button>
      </div>
      <p className="settings-about">{t('settings.about')}</p>
      <div className="attribution">
        <img src={tmdbLogo} alt="TMDB" />
        <span>{t('settings.tmdb')}</span>
      </div>
    </div>
  );
}
