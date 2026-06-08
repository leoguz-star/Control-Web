import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import CajasSocios from '@/pages/CajasSocios'
import Configuracion from '@/pages/Configuracion'
import SocioDetail from '@/pages/SocioDetail'
import Transacciones from '@/pages/Transacciones'
import Importar from '@/pages/Importar'
import Chatbot from '@/pages/Chatbot'
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
          <Route path="cajas" element={<CajasSocios />} />
          <Route path="configuracion" element={<Configuracion />} />
          <Route path="socios/:id" element={<SocioDetail />} />
          <Route path="transacciones" element={<Transacciones />} />
          <Route path="importar" element={<Importar />} />
          <Route path="chatbot" element={<Chatbot />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
