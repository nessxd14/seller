import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PosPage } from './pages/PosPage'
import './styles.css'
import './phase11.css'
import './workflows.css'
import './print.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PosPage />
  </StrictMode>,
)
