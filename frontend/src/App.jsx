import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';

import Login from './pages/Login';
import DashboardHome from './pages/DashboardHome';
import Lots from './pages/Lots';
import LotDetail from './pages/LotDetail';
import Scan from './pages/Scan';
import Requisitions from './pages/Requisitions';
import Alerts from './pages/Alerts';
import Anomalies from './pages/Anomalies';
import Forecast from './pages/Forecast';
import LedgerExplorer from './pages/LedgerExplorer';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardHome />} />
            <Route path="lots" element={<Lots />} />
            <Route path="lots/:lotID" element={<LotDetail />} />
            <Route path="scan" element={<Scan />} />
            <Route path="requisitions" element={<Requisitions />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="anomalies" element={<Anomalies />} />
            <Route path="forecast" element={<Forecast />} />
            <Route path="ledger" element={<LedgerExplorer />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
