import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PrefsProvider } from './i18n/PrefsContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </StrictMode>,
)
