import { createHashRouter } from 'react-router';
import { Layout } from './Layout';
import { About } from './screens/About';
import { Downloads } from './screens/Downloads';
import { Home } from './screens/Home';
import { Onboarding } from './screens/onboarding/Onboarding';
import { SettingsScreen } from './screens/settings/SettingsScreen';

export function createRouter() {
  return createHashRouter([
    { path: '/onboarding', element: <Onboarding /> },
    {
      element: <Layout />,
      children: [
        { path: '/', element: <Home /> },
        { path: '/downloads', element: <Downloads /> },
        { path: '/settings', element: <SettingsScreen /> },
        { path: '/about', element: <About /> },
      ],
    },
  ]);
}
