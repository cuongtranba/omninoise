import { Outlet } from 'react-router';

export default function OAuthLayout() {
  return (
    <div className="bg-[#0B0A0A] flex flex-1 min-h-screen w-screen">
      <title>Authorize Application</title>
      <Outlet />
    </div>
  );
}
