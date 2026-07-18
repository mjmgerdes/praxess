import React, { useState } from 'react'
import CaseWorkspace from './CaseWorkspace.jsx'
import LoopApp from './LoopApp.jsx'

export default function WorkspaceApp() {
  const [activeCase, setActiveCase] = useState(null)

  if (activeCase) {
    return <LoopApp key={activeCase} onBackToWorkspace={() => setActiveCase(null)} />
  }

  return <CaseWorkspace onOpenCase={setActiveCase} />
}
