import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { App } from './App';
import { StatusBar } from './StatusBar';

registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(<StrictMode><div className="device"><App /></div><StatusBar /></StrictMode>);
