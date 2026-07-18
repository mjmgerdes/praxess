import React, { useMemo, useState } from 'react'
import './workspace.css'

const CASES = [
  {
    id: 'PA-4471',
    patient: 'Kovacek, Emory',
    initials: 'EK',
    demographics: '22M',
    procedure: 'MRI lumbar spine w/o contrast',
    cpt: '72148',
    payer: 'Meridian Health Plan',
    plan: 'Commercial',
    status: 'needs-action',
    statusLabel: 'Action required',
    stage: 'Gathering evidence',
    readiness: 70,
    nextAction: 'Review clinical-note addendum',
    due: 'Today',
    updated: 'Just now',
    openable: true,
    criteria: [
      { id: 'C1', state: 'documented' },
      { id: 'C2', state: 'documented' },
      { id: 'C3', state: 'documented' },
      { id: 'C4', state: 'partial' },
      { id: 'C5', state: 'unknown' },
    ],
  },
  {
    id: 'DEMO-01',
    patient: 'Renner, Julius',
    initials: 'JR',
    demographics: '35M',
    procedure: 'MRI lumbar spine w/o contrast',
    cpt: '72148',
    payer: 'DemoCare Health Plan',
    plan: 'Synthetic demo',
    status: 'needs-action',
    statusLabel: 'Patient input needed',
    stage: 'Evidence recovery',
    readiness: 62,
    nextAction: 'Ask one PT-history question',
    due: 'Next',
    updated: 'Prepared',
    openable: false,
    criteria: [
      { id: 'C1', state: 'documented' },
      { id: 'C2', state: 'partial' },
      { id: 'C3', state: 'partial' },
      { id: 'C4', state: 'documented' },
      { id: 'C5', state: 'partial' },
    ],
  },
  {
    id: 'DEMO-02',
    patient: 'Casas, Eva',
    initials: 'EC',
    demographics: '62F',
    procedure: 'MRI knee w/o contrast',
    cpt: '73721',
    payer: 'DemoCare Health Plan',
    plan: 'Synthetic demo',
    status: 'needs-action',
    statusLabel: 'Clinician review',
    stage: 'Addendum candidate',
    readiness: 76,
    nextAction: 'Review transcript-backed addendum',
    due: 'Next',
    updated: 'Prepared',
    openable: false,
    criteria: [
      { id: 'C1', state: 'documented' },
      { id: 'C2', state: 'documented' },
      { id: 'C3', state: 'documented' },
      { id: 'C4', state: 'partial' },
      { id: 'C5', state: 'documented' },
    ],
  },
  {
    id: 'DEMO-03',
    patient: "O'Reilly, Van",
    initials: 'VO',
    demographics: '42M',
    procedure: 'Occupational therapy evaluation',
    cpt: '97003',
    payer: 'DemoCare Health Plan',
    plan: 'Synthetic demo',
    status: 'waiting',
    statusLabel: 'Evidence confirmation',
    stage: 'Patient question',
    readiness: 68,
    nextAction: 'Confirm no prior occupational therapy',
    due: 'Next',
    updated: 'Prepared',
    openable: false,
    criteria: [
      { id: 'C1', state: 'documented' },
      { id: 'C2', state: 'documented' },
      { id: 'C3', state: 'partial' },
      { id: 'C4', state: 'unknown' },
      { id: 'C5', state: 'documented' },
    ],
  },
]

const FILTERS = [
  { id: 'all', label: 'All', count: 4 },
  { id: 'needs-action', label: 'Needs action', count: 3 },
  { id: 'waiting', label: 'Waiting', count: 1 },
  { id: 'ready', label: 'Ready', count: 0 },
]

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 8h9M8.8 4.5 12.3 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11 11 3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
      <rect x="2.5" y="3" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 6.5h7M5.5 9h7M5.5 11.5h4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export default function CaseWorkspace({ onOpenCase }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const visibleCases = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return CASES.filter((caseItem) => {
      const matchesFilter = filter === 'all' || caseItem.status === filter
      const haystack = `${caseItem.patient} ${caseItem.procedure} ${caseItem.cpt} ${caseItem.payer} ${caseItem.id}`.toLowerCase()
      return matchesFilter && (!normalized || haystack.includes(normalized))
    })
  }, [filter, query])

  return (
    <div className="prx-workspace">
      <header className="prx-workspace-topbar">
        <div className="prx-workspace-brand">
          <img src="/praxess_favicon.png" alt="" aria-hidden="true" />
          <strong>Praxess</strong>
          <span>Case workspace</span>
        </div>
        <div className="prx-workspace-topbar-right">
          <div className="prx-workspace-live"><i /> ENGINE LIVE</div>
          <div className="prx-workspace-user" aria-label="Signed in as Dr. Reyes">DR</div>
        </div>
      </header>

      <div className="prx-workspace-shell">
        <aside className="prx-workspace-sidebar" aria-label="Workspace navigation">
          <div className="prx-workspace-nav-label">Workspace</div>
          <div className="prx-workspace-nav-active" aria-current="page">
            <QueueIcon />
            <span>Case queue</span>
            <b>4</b>
          </div>
          <div className="prx-workspace-model-card">
            <div className="prx-workspace-model-head">
              <span><i /> WORLD MODEL</span>
              <b>v1</b>
            </div>
            <strong>Case intelligence online</strong>
            <p>Three safe actions are ready to roll forward for the active case.</p>
            <div className="prx-workspace-signal" aria-hidden="true">
              <span /><span /><span /><span /><span />
            </div>
          </div>
          <div className="prx-workspace-sidebar-foot">
            <span>Praxess care team</span>
            <small>Prior authorization operations</small>
          </div>
        </aside>

        <main className="prx-workspace-main" id="case-workspace-main">
          <div className="prx-workspace-title-row">
            <div>
              <div className="prx-workspace-kicker">Operations · Prior authorization</div>
              <h1>Case workspace</h1>
              <p>Every authorization is a living state—open a case to inspect evidence, simulate futures, and execute the next safe action.</p>
            </div>
            <div className="prx-workspace-clock">
              <span>DEMO SHIFT</span>
              <strong>4 prepared · 1 interactive</strong>
            </div>
          </div>

          <section className="prx-workspace-metrics" aria-label="Queue summary">
            <article>
              <span>Prepared cases</span>
              <strong>04</strong>
              <small>Synthetic demo records</small>
            </article>
            <article className="is-action">
              <span>Interactive cases</span>
              <strong>01</strong>
              <small>Full closed-loop path</small>
            </article>
            <article>
              <span>Open evidence gaps</span>
              <strong>07</strong>
              <small>Across prepared cases</small>
            </article>
            <article className="is-model">
              <span>Model activity</span>
              <strong>03</strong>
              <small>Futures simulated</small>
            </article>
          </section>

          <section className="prx-case-queue" aria-labelledby="case-queue-title">
            <div className="prx-case-queue-head">
              <div>
                <div className="prx-case-queue-heading">
                  <h2 id="case-queue-title">Case queue</h2>
                  <span>LIVE</span>
                </div>
                <p>Cases are ranked by required action and evidence risk.</p>
              </div>
              <label className="prx-case-search">
                <SearchIcon />
                <span className="prx-sr-only">Search cases</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search patient, CPT, payer…"
                />
              </label>
            </div>

            <div className="prx-case-filters" aria-label="Filter cases">
              {FILTERS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}<span>{item.count}</span>
                </button>
              ))}
            </div>

            <div className="prx-case-columns" aria-hidden="true">
              <span>Patient / procedure</span>
              <span>Payer</span>
              <span>Case state</span>
              <span>Next best action</span>
              <span />
            </div>

            <div className="prx-case-list" aria-live="polite">
              {visibleCases.map((caseItem) => (
                <article className="prx-case-row" key={caseItem.id}>
                  <div className="prx-case-patient">
                    <div className="prx-case-avatar">{caseItem.initials}</div>
                    <div>
                      <div className="prx-case-patient-name">
                        <strong>{caseItem.patient}</strong>
                        <span>{caseItem.demographics}</span>
                      </div>
                      <p>{caseItem.procedure} · {caseItem.cpt}</p>
                      <small>CASE {caseItem.id} · updated {caseItem.updated}</small>
                    </div>
                  </div>

                  <div className="prx-case-payer">
                    <strong>{caseItem.payer}</strong>
                    <span>{caseItem.plan}</span>
                  </div>

                  <div className="prx-case-state">
                    <div className="prx-case-status"><i /> {caseItem.statusLabel}</div>
                    <div className="prx-case-readiness">
                      <span>{caseItem.readiness}% ready</span>
                      <div><i style={{ width: `${caseItem.readiness}%` }} /></div>
                    </div>
                    <div className="prx-case-criteria" aria-label="Criterion states">
                      {caseItem.criteria.map((criterion) => (
                        <span key={criterion.id} className={`is-${criterion.state}`}>{criterion.id}</span>
                      ))}
                    </div>
                  </div>

                  <div className="prx-case-next">
                    <span>ARGMAX · HUMAN GATE</span>
                    <strong>{caseItem.nextAction}</strong>
                    <small>Due {caseItem.due}</small>
                  </div>

                  {caseItem.openable ? (
                    <button type="button" className="prx-open-case" onClick={() => onOpenCase(caseItem.id)}>
                      Open case <ArrowIcon />
                    </button>
                  ) : (
                    <div className="prx-case-prepared" aria-label="Synthetic case data prepared">
                      <i /> Data ready
                    </div>
                  )}
                </article>
              ))}
              {visibleCases.length === 0 && (
                <div className="prx-case-empty">
                  <strong>No cases match this view.</strong>
                  <span>Clear the search or choose another filter.</span>
                </div>
              )}
            </div>
          </section>

          <p className="prx-workspace-note">Prototype workspace · operational and outcome values shown for demonstration only.</p>
        </main>
      </div>
    </div>
  )
}
