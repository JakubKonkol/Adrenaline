import { Download, Info, Search, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
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
  const items: Item[] = [
    { to: '/', label: t('nav.search'), icon: <Search size={15} />, end: true },
    { to: '/downloads', label: t('nav.downloads'), icon: <Download size={15} /> },
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
