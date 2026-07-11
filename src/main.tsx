import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Inicio from './pages/Inicio'
import Venta from './pages/Venta'
import Planos from './pages/Planos'
import AuthGate from './features/auth/AuthGate'

const router = createBrowserRouter([
  { path: '/', element: <Inicio /> },
  { path: '/venta/:projectId', element: <Venta /> },
  { path: '/planos/:projectId', element: <Planos /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </React.StrictMode>,
)
