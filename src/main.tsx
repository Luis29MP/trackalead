import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installGlobalErrorHandlers } from './lib/errorLog'
import { applyTextScale, getTextScale } from './lib/textScale'

installGlobalErrorHandlers()
applyTextScale(getTextScale())   // tamaño de letra elegido en este dispositivo

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
