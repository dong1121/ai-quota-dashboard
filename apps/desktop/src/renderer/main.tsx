import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { AnalyticsWindow } from './components/AnalyticsWindow.js';
import './styles.css';

const isAnalyticsRoute = window.location.hash === '#analytics';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAnalyticsRoute ? <AnalyticsWindow /> : <App />}
  </React.StrictMode>,
);
