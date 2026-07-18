import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LoopApp from './LoopApp.jsx'

// Loop UI (design handoff port) is the app; ?classic=1 keeps the engine console.
const classic = new URLSearchParams(window.location.search).has('classic')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {classic ? <App /> : <LoopApp />}
  </StrictMode>,
)
