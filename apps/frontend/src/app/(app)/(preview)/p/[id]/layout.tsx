import { Outlet } from 'react-router';
import { PreviewWrapper } from '@gitroom/frontend/components/preview/preview.wrapper';

export default function AppLayout() {
  return (
    <div className="bg-newBgColor min-h-screen text-newTextColor">
      <PreviewWrapper>
        <Outlet />
      </PreviewWrapper>
    </div>
  );
}
