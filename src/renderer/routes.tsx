import { createHashRouter } from 'react-router';
import { Layout } from './Layout';
import { About } from './screens/About';
import { Downloads } from './screens/downloads/Downloads';
import { JobDetails } from './screens/downloads/JobDetails';
import { Home } from './screens/Home';
import { Details } from './screens/catalog/Details';
import { Season } from './screens/catalog/Season';
import { Releases } from './screens/catalog/Releases';
import { DownloadSetup } from './screens/DownloadSetup';
import { Onboarding } from './screens/onboarding/Onboarding';
import { SettingsScreen } from './screens/settings/SettingsScreen';

export function createRouter() {
  return createHashRouter([
    { path: '/onboarding', element: <Onboarding /> },
    {
      element: <Layout />,
      children: [
        { path: '/', element: <Home /> },
        { path: '/title/:type/:id', element: <Details /> },
        { path: '/title/tv/:id/season/:n', element: <Season /> },
        { path: '/releases', element: <Releases /> },
        { path: '/download-setup', element: <DownloadSetup /> },
        { path: '/downloads', element: <Downloads /> },
        { path: '/downloads/:jobId', element: <JobDetails /> },
        { path: '/settings', element: <SettingsScreen /> },
        { path: '/about', element: <About /> },
      ],
    },
  ]);
}
