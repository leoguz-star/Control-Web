import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Transacciones from '@/pages/Transacciones'
import Importar from '@/pages/Importar'
import { useAuth } from '@/hooks/useAuth'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-full grid place-items-center text-gray-500">
        Cargando…
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="transacciones" element={<Transacciones />} />
          <Route path="importar" element={<Importar />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
