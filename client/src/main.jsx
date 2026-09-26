import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider, Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import MapPage from './pages/MapPage.jsx';
import Alerts from './pages/Alerts.jsx';
import AlertDetail from './pages/AlertDetail.jsx';
import CellDetail from './pages/CellDetail.jsx';
import FieldTasks from './pages/FieldTasks.jsx';
import Analytics from './pages/Analytics.jsx';
import DataPage from './pages/DataPage.jsx';
import Admin from './pages/Admin.jsx';
import Methodology from './pages/Methodology.jsx';

function Protected({ children, roles }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={user.role === 'field_officer' ? '/app/field' : '/app'} replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  return user?.role === 'field_officer' ? <Navigate to="/app/field" replace /> : <Dashboard />;
}

const STAFF = ['admin', 'analyst'];

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/app" element={<Protected><Layout /></Protected>}>
              <Route index element={<Home />} />
              <Route path="map" element={<MapPage />} />
              <Route path="alerts" element={<Protected roles={STAFF}><Alerts /></Protected>} />
              <Route path="alerts/:id" element={<AlertDetail />} />
              <Route path="cells/:id" element={<CellDetail />} />
              <Route path="field" element={<FieldTasks />} />
              <Route path="analytics" element={<Protected roles={STAFF}><Analytics /></Protected>} />
              <Route path="data" element={<Protected roles={STAFF}><DataPage /></Protected>} />
              <Route path="admin" element={<Protected roles={['admin']}><Admin /></Protected>} />
              <Route path="method" element={<Methodology />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
);
