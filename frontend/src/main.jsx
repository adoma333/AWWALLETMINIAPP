import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import App from './App.jsx';
import { ToastProvider } from './components/Toast';
import { applyTheme, watchTheme } from './theme';
import { setupTelegram } from './telegram';

setupTelegram();
applyTheme();
watchTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
