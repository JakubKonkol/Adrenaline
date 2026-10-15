import { Download, Info, Search, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useDownloads } from '../api/downloads';
import { t } from '../i18n/t';
import styles from './Sidebar.module.css';

interface Item {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: ReactNode;
}

export function Sidebar() {
  const { data: jobs } = useDownloads();
  const active = (jobs ?? []).filter((j) => !['downloaded', 'seeding', 'stopped'].includes(j.state)).length;
  const items: Item[] = [
    { to: '/', label: t('nav.search'), icon: <Search size={15} />, end: true },
    {
      to: '/downloads',
      label: t('nav.downloads'),
      icon: <Download size={15} />,
      ...(active > 0
        ? {
            badge: (
              <span
                className={styles.count}
                aria-label={t('nav.activeCount', { count: active })}
                data-testid="nav-active-count"
              >
                {active}
              </span>
            ),
          }
        : {}),
    },
    { to: '/settings', label: t('nav.settings'), icon: <Settings size={15} /> },
    { to: '/about', label: t('nav.about'), icon: <Info size={15} /> },
  ];
  return (
    <nav className={styles.sidebar} aria-label={t('nav.label')}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.icon} aria-hidden>
                {item.icon}
              </span>
              <span className={styles.label}>{item.label}</span>
              {item.badge}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
