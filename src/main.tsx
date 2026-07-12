import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom'
import './index.css'
import Inicio from './pages/Inicio'
import Venta from './pages/Venta'
import Planos from './pages/Planos'
import AuthGate from './features/auth/AuthGate'
import Paleta from './features/kbar/Paleta'
import TituloBadge from './features/kbar/TituloBadge'
import Presencia from './features/presencia/Presencia'

// Capa común a todas las rutas: buscador Ctrl+K, contador del título de la
// pestaña y presencia del equipo en vivo.
function Shell() {
  return (
    <>
      <Outlet />
      <Paleta />
      <TituloBadge />
      <Presencia />
    </>
  )
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Inicio /> },
      { path: '/venta/:projectId', element: <Venta /> },
      { path: '/planos/:projectId', element: <Planos /> },
      // Cualquier otra URL vuelve al inicio (sin pantalla de error en inglés).
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </React.StrictMode>,
)
