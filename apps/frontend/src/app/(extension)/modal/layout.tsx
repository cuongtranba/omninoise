import { Outlet } from 'react-router';
import { AppLayout } from '@gitroom/frontend/components/launches/layout.standalone';

export default function AppLayoutIn() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
