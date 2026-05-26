import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import classes from './HotelPMS.module.css';
import Sidebar from './components/Sidebar/Sidebar';
import Dashboard from './components/Dashboard/Dashboard';
import Timeline from './components/Timeline/Timeline';
import Bookings from './components/Bookings/Bookings';
import Rooms from './components/Rooms/Rooms';
import Housekeeping from './components/Housekeeping/Housekeeping';
import Tariffs from './components/Tariffs/Tariffs';
import Revenue from './components/Revenue/Revenue';
import Reports from './components/Reports/Reports';
import Settings from './components/Settings/Settings';
import Team from './components/Team/Team';
import { useTenantSettings } from '../../hooks/api/useTenantSettings';
import ImpersonationBanner from '../AdminPanel/ImpersonationBanner';

const SECTIONS = ['dashboard', 'timeline', 'bookings', 'rooms', 'housekeeping', 'tariffs', 'revenue', 'reports', 'team', 'settings'];

function HotelPMS() {
  const location = useLocation();
  const navigate = useNavigate();

  const pathSection = location.pathname.slice(1);
  const activeSection = SECTIONS.includes(pathSection) ? pathSection : 'dashboard';

  const { data: tenantSettings } = useTenantSettings();

  const hotel = tenantSettings
    ? {
        name:    tenantSettings.name,
        city:    tenantSettings.city,
        address: tenantSettings.address,
        stars:   tenantSettings.stars,
      }
    : null;

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':    return <Dashboard />;
      case 'timeline':     return <Timeline multiPlaceEnabled={tenantSettings?.multiPlaceEnabled ?? false} />;
      case 'bookings':     return <Bookings />;
      case 'rooms':        return <Rooms />;
      case 'housekeeping': return <Housekeeping />;
      case 'tariffs':      return <Tariffs />;
      case 'revenue':      return <Revenue />;
      case 'reports':      return <Reports />;
      case 'team':         return <Team />;
      case 'settings':     return <Settings />;
      default:             return null;
    }
  };

  return (
    <div className={classes.root}>
      <Sidebar hotel={hotel} />
      <div className={classes.body}>
        <ImpersonationBanner />
        <main className={classes.content}>
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

export default HotelPMS;
