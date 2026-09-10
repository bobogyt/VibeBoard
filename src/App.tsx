import { Navigate, Route, Routes } from 'react-router'
import { Spin } from 'antd'
import { useAuthContext } from './hooks/useAuthContext'
import BasicLayout from './layouts/BasicLayout'
import LoginPage from './pages/LoginPage'
import BoardPage from './pages/BoardPage'
import ProjectsPage from './pages/ProjectsPage'
import ArchivePage from './pages/ArchivePage'
import StatsPage from './pages/StatsPage'
import AutomationsPage from './pages/AutomationsPage'

export default function App() {
  const { status, expireSession } = useAuthContext()

  if (status === 'loading') {
    return (
      <div className="app-splash">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={status === 'authed' ? <Navigate to="/board" replace /> : <LoginPage />} />
      <Route element={status === 'anon' ? <Navigate to="/login" replace /> : <BasicLayout />}>
        <Route index element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<BoardPage onUnauthorized={expireSession} />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/archive" element={<ArchivePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/board" replace />} />
    </Routes>
  )
}
