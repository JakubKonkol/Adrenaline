import { Navigate, Outlet } from 'react-router';
import { useSettings } from './api/settings';
import { ServiceBanner } from './components/ServiceBanner';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import styles from './Layout.module.css';

export function Layout() {
  const { data: settings } = useSettings();
  if (settings && !settings.onboardingDone) return <Navigate to="/onboarding" replace />;
  return (
    <div className={styles.shell}>
      <TitleBar />
      <UpdateBanner />
      <ServiceBanner />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.content}>{settings ? <Outlet /> : null}</main>
      </div>
    </div>
  );
}
