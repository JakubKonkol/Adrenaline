import { createHashRouter } from 'react-router';
import { Layout } from './Layout';
import { About } from './screens/About';
import { Home } from './screens/Home';

export function createRouter() {
  return createHashRouter([
    {
      element: <Layout />,
      children: [
        { path: '/', element: <Home /> },
        { path: '/about', element: <About /> },
      ],
    },
  ]);
}
