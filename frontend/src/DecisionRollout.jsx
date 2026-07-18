import React from 'react'

const OUTCOMES = {
  favorable: {
    title: 'Approval path strengthens',
    detail: 'The next review starts from a better-supported case.',
    tone: 'positive',
  },
  verification: {
    title: 'Verification path opens',
    detail: 'New information identifies the next resolvable evidence source.',
    tone: 'information',
  },
  review: {
    title: 'Human review becomes actionable',
    detail: 'The case advances without silently converting uncertainty into fact.',
    tone: 'positive',
  },
  more: {
    title: 'More information requested',
    detail: 'The unresolved evidence returns as a new operational task.',
    tone: 'warning',
  },
  denial: {
    title: 'Denial risk remains high',
    detail: 'Submitting the current state preserves the evidence gap.',
    tone: 'danger',
  },
  waiting: {
    title: 'State holds',
    detail: 'No new observation arrives, so there is nothing to replan against.',
    tone: 'neutral',
  },
  submitted: {
    title: 'Payer determination',
    detail: 'The case stays alive until the payer response updates the world state.',
    tone: 'information',
  },
}

function outcomeFor(candidate, phase) {
  const key = candidate.key
  if (key === 'SUBMIT_NOW') {
    if (phase === 'submit') return OUTCOMES.submitted
    if (phase === 'addendum') return OUTCOMES.denial
    return OUTCOMES.more
  }
  if (key === 'ASK_PATIENT') return OUTCOMES.verification
  if (key === 'REQUEST_RECORD') return OUTCOMES.review
  if (key === 'GENERATE_PACKET') return OUTCOMES.review
  if (key === 'DRAFT_ADDENDUM') return OUTCOMES.favorable
  if (key === 'HOLD') return OUTCOMES.waiting
  if (key === 'ASK_CLINICIAN') return candidate.recommended ? OUTCOMES.verification : OUTCOMES.waiting
  return candidate.recommended ? OUTCOMES.favorable : OUTCOMES.waiting
}

function FlowArrow({ active }) {
  return (
    <div className={`prx-flow-arrow ${active ? 'is-active' : ''}`} aria-hidden="true">
      <span className="prx-flow-dot" />
    </div>
  )
}

function ExecuteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.2 8h8.4M8.8 4.8 12 8l-3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function DecisionRollout({
  candidates,
  criteria,
  readinessPct,
  readinessColor,
  openCount,
  stateVersion,
  lastEvent,
  phase,
  fitMeta,
  flywheel,
  weights,
}) {
  const selected = candidates.find((candidate) => candidate.recommended) || candidates[0]

  return (
    <section className="prx-rollout" aria-labelledby="decision-rollout-title">
      <header className="prx-rollout-header">
        <div>
          <div className="prx-kicker">03 · Decision engine</div>
          <h1 id="decision-rollout-title">Next best action</h1>
          <p>
            Each safe action is rolled forward and scored by how it changes the case. Praxess recommends one; a person approves it.
          </p>
        </div>
      </header>

      <div className="prx-decision-rule">
        <span className="prx-decision-rule-label">SCORING</span>
        <span>EV(a | s) = {weights.approval}·Δ approval + {weights.info}·information − {weights.time}·delay − {weights.burden}·burden</span>
        <small title={`${fitMeta} · ${flywheel}`}>{fitMeta} · {flywheel}</small>
      </div>

      <div className="prx-rollout-stage">
        <div className="prx-rollout-axis" aria-hidden="true">
          <span>Case today</span>
          <span>Candidate action</span>
          <span>Predicted state</span>
          <span>Likely payer response</span>
        </div>

        <div className="prx-rollout-grid">
          <div className="prx-state-core-wrap">
            <div className="prx-state-core">
              <span className="prx-node-label">Case state</span>
              <strong style={{ color: readinessColor }}>{readinessPct}%</strong>
              <span className="prx-state-caption">evidence readiness</span>
              <div className="prx-state-metrics">
                <span>{openCount} open</span>
              </div>
              <div className="prx-state-criteria" aria-label="Current criterion states">
                {criteria.map((criterion) => (
                  <span
                    key={criterion.id}
                    title={`${criterion.label}: ${criterion.packetTag}`}
                    style={{ color: criterion.chipColor, borderColor: criterion.chipBorder, background: criterion.chipBg }}
                  >
                    {criterion.id}
                  </span>
                ))}
              </div>
              <small>last observation · {lastEvent}</small>
            </div>
          </div>

          <div className="prx-rollout-branches">
            {candidates.map((candidate) => {
              const outcome = outcomeFor(candidate, phase)
              return (
                <article
                  className={`prx-trajectory ${candidate.recommended ? 'is-selected' : ''}`}
                  key={candidate.key + candidate.title}
                  aria-label={`${candidate.recommended ? 'Recommended. ' : ''}${candidate.title}. Predicted state: ${candidate.delta}. ${outcome.title}.`}
                >
                  <div className="prx-action-node">
                    {candidate.recommended && <span className="prx-argmax">Recommended</span>}
                    <strong>{candidate.title}</strong>
                    <div className="prx-ev-row">
                      <span>EV(a | s)</span>
                      <b>{candidate.scoreText}</b>
                    </div>
                    <div className="prx-ev-track" aria-hidden="true">
                      <span style={{ width: `${candidate.scorePct}%` }} />
                    </div>
                  </div>

                  <FlowArrow active={candidate.recommended} />

                  <div className="prx-future-node">
                    <strong>{candidate.delta}</strong>
                    <p>{candidate.desc}</p>
                    <small>{candidate.evTerms}</small>
                  </div>

                  <FlowArrow active={candidate.recommended} />

                  <div className={`prx-outcome-node tone-${outcome.tone}`}>
                    <strong>{outcome.title}</strong>
                    <p>{outcome.detail}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </div>

      <div className="prx-execution-layer">
        <div>
          <span className="prx-node-label">Human approval</span>
          <strong>{selected?.title}</strong>
          <p>Praxess proposes. A person commits the action.</p>
        </div>
        {selected?.cta && (
          <button type="button" onClick={selected.onExecute}>
            {selected.cta}
            <ExecuteIcon />
          </button>
        )}
      </div>

      <p className="prx-rollout-disclaimer">
        Prototype — value scores are directional, not clinically or payer calibrated.
      </p>
    </section>
  )
}
