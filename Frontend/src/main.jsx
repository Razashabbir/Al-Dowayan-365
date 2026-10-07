import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { AppProvider } from './theme.jsx'
import { AuthProvider } from './auth.jsx'
import { ConfigProvider } from './config.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <ConfigProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ConfigProvider>
  </AppProvider>,
)
