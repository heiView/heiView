import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import 'antd/dist/reset.css'
import './styles.css'

function Router() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/*" element={<App />} />
    </Routes>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')
createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  </React.StrictMode>
)
