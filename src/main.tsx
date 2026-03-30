import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('A new Zaya Pocket build is available.');
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('zaya:offline-ready'));
  },
});

void updateSW;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
