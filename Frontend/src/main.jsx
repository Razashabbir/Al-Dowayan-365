import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { AppProvider } from './theme.jsx'
import { AuthProvider } from './auth.jsx'
import { ConfigProvider } from './config.jsx'
import './styles.css'
import { installTooltips } from './components/tooltip'
import { installSelects } from './components/selects'

installTooltips()   // animated bubbles for every title="..." in the app
installSelects()    // animated, theme-coloured lists for every <select>

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <ConfigProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ConfigProvider>
  </AppProvider>,
)
