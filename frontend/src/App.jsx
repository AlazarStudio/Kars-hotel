import { Navigate, Route, Routes } from 'react-router-dom';
import HotelPMS from './Components/HotelPMS/HotelPMS';
import Login from './Components/Auth/Login';
import Register from './Components/Auth/Register';
import ProtectedRoute from './auth/ProtectedRoute';

const SECTIONS = ['dashboard', 'timeline', 'bookings', 'rooms', 'housekeeping', 'tariffs', 'revenue', 'reports', 'settings'];

const ProtectedPMS = () => (
  <ProtectedRoute>
    <HotelPMS />
  </ProtectedRoute>
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* One route per PMS section — URL always reflects the active view */}
      {SECTIONS.map((s) => (
        <Route key={s} path={`/${s}`} element={<ProtectedPMS />} />
      ))}

      {/* Redirect legacy and bare-root paths */}
      <Route path="/hotel-pms" element={<Navigate to="/dashboard" replace />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
