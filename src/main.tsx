import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import { App } from './app/App';
import { initPersistence } from './store/persistence';
import { useStore } from './store/store';

// Test/debug hook used by the Playwright suite.
(window as unknown as { __store: typeof useStore }).__store = useStore;

void initPersistence();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
