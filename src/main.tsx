import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'antd/dist/reset.css'
import './styles.css'

console.debug('[main] React entry loaded');

const rootEl = document.getElementById('root');
if (!rootEl) console.error('[main] #root not found');
createRoot(rootEl!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
