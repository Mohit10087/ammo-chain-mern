import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <TopBar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
