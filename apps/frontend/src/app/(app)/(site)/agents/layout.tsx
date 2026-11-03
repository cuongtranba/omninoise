import { Outlet } from 'react-router';
import { Agent } from '@gitroom/frontend/components/agents/agent';

export default function Layout() {
  return (
    <>
      <title>Omninoise - Agent</title>
      <Agent>
        <Outlet />
      </Agent>
    </>
  );
}
