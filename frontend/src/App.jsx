import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ScheduleProvider } from './context/ScheduleContext'
import { PrefsProvider } from './context/PrefsContext'
import { NotesProvider } from './context/NotesContext'
import { TooltipProvider } from './components/Tooltip'
import Sidebar from './components/Sidebar'
import AuthPage from './pages/AuthPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import Dashboard from './pages/Dashboard'
import FamilyPage from './pages/FamilyPage'
import SchedulePage from './pages/SchedulePage'
import AvailabilityPage from './pages/AvailabilityPage'
import OverlapPage from './pages/OverlapPage'
import PrivacyPage from './pages/PrivacyPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'
import NotesPage    from './pages/NotesPage'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg)' }}>
      <span className="spinner" style={{ width:24, height:24 }} />
    </div>
  )
  if (!user) return <Navigate to="/auth" replace />
  return (
    <ScheduleProvider>
     <NotesProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          {children}
        </div>
      </div>
     </NotesProvider>
    </ScheduleProvider>
  )
}

function Public({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
       <PrefsProvider>
        <ToastProvider>
         <TooltipProvider>
          <Routes>
            <Route path="/auth" element={<Public><AuthPage /></Public>} />
            <Route path="/forgot-password" element={<Public><ForgotPasswordPage /></Public>} />
            <Route path="/reset-password/:token" element={<Public><ResetPasswordPage /></Public>} />
            <Route path="/"            element={<Protected><Dashboard /></Protected>} />
            <Route path="/family"      element={<Protected><FamilyPage /></Protected>} />
            <Route path="/schedule"    element={<Protected><SchedulePage /></Protected>} />
            <Route path="/availability"element={<Protected><AvailabilityPage /></Protected>} />
            <Route path="/overlap"     element={<Protected><OverlapPage /></Protected>} />
            <Route path="/privacy"     element={<Protected><PrivacyPage /></Protected>} />
            <Route path="/settings"    element={<Protected><SettingsPage /></Protected>} />
            <Route path="/profile"     element={<Protected><ProfilePage /></Protected>} />
            <Route path="/notes"       element={<Protected><NotesPage    /></Protected>} />
            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
         </TooltipProvider>
        </ToastProvider>
       </PrefsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
