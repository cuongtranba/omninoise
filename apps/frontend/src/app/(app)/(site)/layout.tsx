import { Outlet } from 'react-router';
import { LayoutComponent } from '@gitroom/frontend/components/new-layout/layout.component';

export default function Layout() {
  return (
    <LayoutComponent>
      <Outlet />
    </LayoutComponent>
  );
}
