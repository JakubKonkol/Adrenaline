import { t } from '../i18n';
import { type Tab, useNav } from '../nav';
import { Focusable } from '../ui';
import logo from '../assets/adrenaline-mark-on-dark.svg';
import { Discover } from './Discover';
import { Library } from './Library';

/** Top bar like Apple TV: tabs in the middle, settings on the right. */
export function Home({ tab }: { tab: Tab }) {
  const nav = useNav();
  const tabs: { id: Tab; label: string }[] = [
    { id: 'discover', label: t('nav.discover') },
    { id: 'library', label: t('nav.library') },
  ];
  return (
    <div className="screen home" data-page="">
      <header className="topbar">
        <img className="topbar-logo" src={logo} alt="" />
        <nav className="tabs">
          {tabs.map((x) => (
            <Focusable
              key={x.id}
              group="tabs"
              focusKey={`tab-${x.id}`}
              autoFocus={tab === x.id}
              className={`tab ${tab === x.id ? 'is-active' : ''}`}
              onSelect={() => nav.replace({ name: 'home', tab: x.id })}
              // Moving along the tabs switches the content at once, like on Apple TV.
              onFocus={() => {
                if (tab !== x.id) nav.replace({ name: 'home', tab: x.id });
              }}
              testId={`tab-${x.id}`}
            >
              {x.label}
            </Focusable>
          ))}
        </nav>
        <Focusable
          group="tabs"
          focusKey="tab-settings"
          className="tab tab-icon"
          label={t('nav.settings')}
          onSelect={() => nav.push({ name: 'settings' })}
        >
          <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
            />
          </svg>
        </Focusable>
      </header>
      {tab === 'discover' ? <Discover /> : <Library />}
    </div>
  );
}
