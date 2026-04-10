import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import 'antd/dist/reset.css'
import './styles.css'

console.debug('[main] React entry loaded');

function Router() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/:lang" element={<App />} />
      <Route path="/:lang/:building" element={<App />} />
    </Routes>
  )
}

const rootEl = document.getElementById('root');
if (!rootEl) console.error('[main] #root not found');
createRoot(rootEl!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  </React.StrictMode>
)
