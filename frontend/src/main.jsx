import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import LoopApp from './LoopApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LoopApp />
  </StrictMode>,
)
