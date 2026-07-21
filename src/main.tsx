import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BuilderApp } from './app/BuilderApp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Builder root is unavailable.');

createRoot(root).render(
  <StrictMode>
    <BuilderApp />
  </StrictMode>,
);
