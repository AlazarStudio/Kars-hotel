import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import classes from './HotelPMS.module.css';
import Sidebar from './components/Sidebar/Sidebar';
import Dashboard from './components/Dashboard/Dashboard';
import Timeline from './components/Timeline/Timeline';
import Bookings from './components/Bookings/Bookings';
import Rooms from './components/Rooms/Rooms';
import Housekeeping from './components/Housekeeping/Housekeeping';
import Tariffs from './components/Tariffs/Tariffs';
import Reports from './components/Reports/Reports';
import { mockBookings, mockRooms, mockCategories, mockTariffs, mockHotel } from './mockData/mock';

const SECTIONS = ['dashboard', 'timeline', 'bookings', 'rooms', 'housekeeping', 'tariffs', 'reports'];

function HotelPMS() {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive active section from URL pathname (e.g. '/timeline' → 'timeline')
  const pathSection = location.pathname.slice(1);
  const activeSection = SECTIONS.includes(pathSection) ? pathSection : 'dashboard';

  const [bookings, setBookings] = useState(mockBookings);
  const [rooms, setRooms] = useState(mockRooms);
  const [tariffs, setTariffs] = useState(mockTariffs);

  const handleNavigate = (section) => navigate(`/${section}`);

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return (
          <Dashboard
            bookings={bookings}
            rooms={rooms}
            categories={mockCategories}
            hotel={mockHotel}
            onNavigate={handleNavigate}
          />
        );
      case 'timeline':
        return <Timeline />;
      case 'bookings':
        return <Bookings />;
      case 'rooms':
        return (
          <Rooms
            rooms={rooms}
            setRooms={setRooms}
            categories={mockCategories}
          />
        );
      case 'housekeeping':
        return (
          <Housekeeping
            rooms={rooms}
            setRooms={setRooms}
            categories={mockCategories}
          />
        );
      case 'tariffs':
        return (
          <Tariffs
            tariffs={tariffs}
            setTariffs={setTariffs}
            categories={mockCategories}
          />
        );
      case 'reports':
        return (
          <Reports
            bookings={bookings}
            rooms={rooms}
            categories={mockCategories}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={classes.root}>
      <Sidebar hotel={mockHotel} />
      <main className={classes.content}>
        {renderContent()}
      </main>
    </div>
  );
}

export default HotelPMS;
