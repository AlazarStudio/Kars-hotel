import { Navigate, Route, Routes } from 'react-router-dom';
import HotelPMS from './Components/HotelPMS/HotelPMS';
import Login from './Components/Auth/Login';
import Register from './Components/Auth/Register';
import AdminPanel from './Components/AdminPanel/AdminPanel';
import ProtectedRoute from './auth/ProtectedRoute';

const SECTIONS = ['dashboard', 'timeline', 'bookings', 'rooms', 'housekeeping', 'tariffs', 'revenue', 'reports', 'settings'];
const ADMIN_SECTIONS = ['hotels', 'users', 'create', 'settings'];

const ProtectedPMS = () => (
  <ProtectedRoute>
    <HotelPMS />
  </ProtectedRoute>
);

const ProtectedAdmin = () => (
  <ProtectedRoute requireSuperAdmin>
    <AdminPanel />
  </ProtectedRoute>
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Super-admin panel with sub-sections */}
      <Route path="/admin" element={<ProtectedAdmin />} />
      {ADMIN_SECTIONS.map((s) => (
        <Route key={s} path={`/admin/${s}`} element={<ProtectedAdmin />} />
      ))}

      {/* PMS sections */}
      {SECTIONS.map((s) => (
        <Route key={s} path={`/${s}`} element={<ProtectedPMS />} />
      ))}

      <Route path="/hotel-pms" element={<Navigate to="/dashboard" replace />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
