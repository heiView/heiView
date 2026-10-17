import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import dayjs from 'dayjs'
import updateLocale from 'dayjs/plugin/updateLocale'
import App from './App'
import PrivacyPolicy from './PrivacyPolicy'
import Imprint from './Imprint'
import Team from './Team'
import AdminLogin from './admin/AdminLogin'
import AdminApp from './admin/AdminApp'
import { isLoggedIn } from './admin/adminAuth'
import 'antd/dist/reset.css'
import './styles.css'

// All date pickers use the default English locale with Monday as the first day.
dayjs.extend(updateLocale)
dayjs.updateLocale('en', { weekStart: 1 })

function RequireAdmin({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

function Router() {
  return (
    <Routes>
      <Route path="/about" element={<Team />} />
      <Route path="/imprint" element={<Imprint />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/*" element={<RequireAdmin><AdminApp /></RequireAdmin>} />
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

