import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate';
import PublicTimetable from './PublicTimetable';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.pathname.replace(/\/$/, '') === '/horarios' ? <PublicTimetable /> : <AuthGate />}</React.StrictMode>,
);
