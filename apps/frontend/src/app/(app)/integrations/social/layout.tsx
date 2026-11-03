import { Outlet } from 'react-router';

export default function IntegrationLayout() {
  return (
    <div className="bg-[#0B0A0A] flex flex-1 min-h-screen w-screen">
      <Outlet />
    </div>
  );
}
