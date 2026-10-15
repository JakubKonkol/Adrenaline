import { Navigate, Outlet } from 'react-router';
import { useSettings } from './api/settings';
import { ServiceBanner } from './components/ServiceBanner';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import styles from './Layout.module.css';
import { t } from './i18n/t';

export function Layout() {
  const { data: settings } = useSettings();
  if (settings && !settings.onboardingDone) return <Navigate to="/onboarding" replace />;
  return (
    <div className={styles.shell}>
      <button className={styles.skip} onClick={() => document.getElementById('main-content')?.focus()}>
        {t('app.skipToContent')}
      </button>
      <TitleBar />
      <UpdateBanner />
      <ServiceBanner />
      <div className={styles.body}>
        <Sidebar />
        <main id="main-content" tabIndex={-1} className={styles.content}>
          {settings ? <Outlet /> : null}
        </main>
      </div>
    </div>
  );
}
