import { Outlet } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.shell}>
      <TitleBar />
      <UpdateBanner />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
