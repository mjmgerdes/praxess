import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const SESSION = 'demo'

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || res.statusText || 'Request failed')
  return data
}

const STATUS_ICON = {
  documented: '✓',
  conversation_enriched: '◉',
  partial: '◑',
  patient_reported: '◈',
  patient_reported_unverified: '◌',
  unknown: '?',
  rejected: '✗',
}
const STATUS_LABEL = {
  documented: 'Documented',
  conversation_enriched: 'Conv. enriched',
  partial: 'Partial',
  patient_reported: 'Patient-reported',
  patient_reported_unverified: 'Patient-reported',
  unknown: 'Unknown',
  rejected: 'Rejected',
}
const ACTION_TYPE_LABEL = {
  ASK_PATIENT: 'Ask patient',
  ASK_CLINICIAN: 'Ask clinician',
  DRAFT_ADDENDUM: 'Draft addendum',
  HUMAN_REVIEW: 'Human review',
  REQUEST_RECORD: 'Request record',
  GENERATE_PACKET: 'Generate packet',
}

function deriveStage(state) {
  if (!state) return 'idle'
  const hasPending = (state.criteria || []).some(
    (c) => c.artifact && ['pending_approval', 'pending_answer'].includes(c.artifact.status),
  )
  if (hasPending) return 'clarifying'
  if ((state.completeness?.open ?? 1) === 0 && (state.completeness?.recoverable ?? 1) === 0)
    return 'ready'
  return 'analyzed'
}

function StageTracker({ stage }) {
  const steps = [
    { key: 'analyzed', label: 'Encounter loaded' },
    { key: 'clarifying', label: 'Clarifying' },
    { key: 'ready', label: 'Packet ready' },
  ]
  const order = ['idle', 'analyzed', 'clarifying', 'ready']
  const cur = order.indexOf(stage)
  return (
    <div className="stage-tracker">
      {steps.map((s, i) => {
        const idx = order.indexOf(s.key)
        const done = cur > idx
        const active = cur === idx
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <div className="stage-connector" />}
            <div className={`stage-step ${done ? 'done' : active ? 'active' : ''}`}>
              <div className="dot" />
              {done ? '✓ ' : ''}{s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SourceChip({ icon, name, meta, content, badge }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`source-chip ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
      <div className="source-chip-head">
        <div className="source-chip-name">
          <span className="source-chip-icon">{icon}</span>
          {name}
        </div>
        {badge && <span className="source-chip-badge">{badge}</span>}
      </div>
      <div className="source-chip-meta">{meta}</div>
      {open && content && <div className="source-chip-expand">{content}</div>}
    </div>
  )
}

function StateChips({ completeness }) {
  const by = completeness?.by_status || {}
  const chips = [
    { key: 'documented', label: 'Documented' },
    { key: 'conversation_enriched', label: 'Conv. enriched' },
    { key: 'partial', label: 'Partial' },
    { key: 'patient_reported', label: 'Patient-reported' },
    { key: 'unknown', label: 'Unknown' },
    { key: 'patient_reported_unverified', label: 'Patient-reported (unverif.)' },
  ]
  return (
    <div className="state-chips">
      {chips.map((c) =>
        (by[c.key] || 0) > 0 ? (
          <span key={c.key} className={`state-chip ${c.key}`}>
            {STATUS_ICON[c.key]} {c.label} ×{by[c.key]}
          </span>
        ) : null,
      )}
    </div>
  )
}

function RecommendedAction({ action, onDecide, loading }) {
  const [answer, setAnswer] = useState('')
  const [edit, setEdit] = useState(action?.body || '')
  const prevArtId = useRef(action?.artifact_id)

  useEffect(() => {
    if (action?.artifact_id !== prevArtId.current) {
      setAnswer('')
      setEdit(action?.body || '')
      prevArtId.current = action?.artifact_id
    }
  }, [action?.artifact_id, action?.body])

  if (!action) return null

  if (action.type === 'GENERATE_PACKET') {
    return (
      <div className="ra-complete">
        ✓ All criteria addressed — open the packet drawer to review the draft summary.
      </div>
    )
  }

  const isQuestion =
    action.artifact_type === 'targeted_question' && action.artifact_status === 'pending_answer'
  const isImperfect = action.artifact_type === 'imperfect_extraction'

  return (
    <div className="recommended-action">
      <div className="ra-header">
        <span className="ra-title">{action.title}</span>
        <span className="ra-type">{ACTION_TYPE_LABEL[action.type] || action.type}</span>
      </div>
      {!isQuestion && (
        <div className="ra-body">{edit}</div>
      )}
      <div className="ra-meta">
        Criterion: <strong>{action.criterion_label}</strong> · Actor:{' '}
        <strong>{action.actor}</strong> · {action.rationale}
      </div>
      {isQuestion ? (
        <div className="ra-answer-box">
          <div className="ra-body">{action.body}</div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Enter patient or clinician answer — stored as patient-reported, not auto-verified…"
          />
          <div className="artifact-actions">
            <button
              className="btn btn-submit btn-sm"
              disabled={loading || !answer.trim()}
              onClick={() => onDecide(action.criterion_id, 'answer', { answer })}
            >
              Submit & replan →
            </button>
          </div>
        </div>
      ) : (
        <div className="ra-actions">
          {!isImperfect && (
            <button
              className="btn btn-approve btn-sm"
              disabled={loading}
              onClick={() => onDecide(action.criterion_id, 'approve', { edit })}
            >
              ✓ Approve
            </button>
          )}
          <button
            className="btn btn-dismiss btn-sm"
            disabled={loading}
            onClick={() => onDecide(action.criterion_id, 'dismiss')}
          >
            {isImperfect ? '✗ Dismiss (bad extraction)' : '✗ Dismiss'}
          </button>
        </div>
      )}
    </div>
  )
}

function CriterionCard({ crit, autoExpand, onDecide, loading }) {
  const [open, setOpen] = useState(autoExpand)
  const [editBody, setEditBody] = useState(crit.artifact?.body || '')
  const [answer, setAnswer] = useState('')

  useEffect(() => {
    setEditBody(crit.artifact?.body || '')
    setAnswer('')
  }, [crit.id, crit.artifact?.status])

  const art = crit.artifact
  const artPending =
    art && ['pending_approval', 'pending_answer'].includes(art.status)

  return (
    <div className={`criterion-card status-${crit.status}`}>
      <button
        className={`criterion-header ${open ? 'expanded' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ch-icon">{STATUS_ICON[crit.status] || '?'}</span>
        <span className="ch-label">{crit.label}</span>
        <span className={`status-pill ${crit.status}`}>
          {STATUS_LABEL[crit.status] || crit.status}
        </span>
        <span className={`ch-toggle ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="criterion-body">
          <div className="crit-summary-text">{crit.summary}</div>

          {/* Evidence layers */}
          {(crit.evidence || []).length > 0 && (
            <div className="evidence-layers">
              {crit.evidence.map((ev, i) => {
                const layer = ev.source_layer || 'unknown'
                const isTranscript = layer === 'transcript'
                const isPatient = ['patient_followup', 'clinician_answer'].includes(layer)
                return (
                  <div className="ev-block" key={i}>
                    <div className={`ev-layer-tag ${layer}`}>
                      <span>
                        {layer === 'transcript' && '🎙 Transcript'}
                        {layer === 'note' && '📄 Note'}
                        {layer === 'fhir' && '🔵 FHIR'}
                        {layer === 'patient_followup' && '👤 Patient answer'}
                        {layer === 'clinician_answer' && '🩺 Clinician answer'}
                        {!['transcript','note','fhir','patient_followup','clinician_answer'].includes(layer) && layer}
                      </span>
                      {layer === 'note' && crit.status === 'conversation_enriched' && (
                        <span className="ev-layer-note">partial — transcript enriches</span>
                      )}
                      {isPatient && (
                        <span className="ev-layer-note">patient-reported · not yet verified</span>
                      )}
                    </div>
                    <div className={`ev-quote ${isTranscript ? 'transcript-quote' : 'note-partial'}`}>
                      "{ev.quoted_span}"
                    </div>
                    {ev.supports && <div className="ev-supports">{ev.supports}</div>}
                  </div>
                )
              })}
            </div>
          )}

          {(crit.evidence || []).length === 0 && (
            <p style={{ color: 'var(--slate)', fontSize: '.88rem', marginBottom: '.5rem' }}>
              No verified evidence spans.
            </p>
          )}

          {/* Artifact — only show if not the active recommended action or if already resolved */}
          {art && !artPending && (
            <div className="artifact-section">
              <div className="artifact-title">
                {art.title}
                <span className={`artifact-badge ${art.status}`}>{art.status}</span>
              </div>
              {art.answer && (
                <div className="artifact-body">Answer recorded: {art.answer}</div>
              )}
              {art.status === 'approved' && art.body && (
                <div className="artifact-body">{art.body}</div>
              )}
            </div>
          )}

          {/* Inline HITL for non-active artifacts that are pending */}
          {art && artPending && art.type !== 'targeted_question' && (
            <div className="artifact-section">
              <div className="artifact-title">
                {art.title}
                <span className={`artifact-badge ${art.type === 'imperfect_extraction' ? 'imperfect' : ''}`}>
                  {art.type === 'imperfect_extraction' ? 'review' : 'draft'}
                </span>
              </div>
              <textarea
                className="artifact-edit"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
              <div className="artifact-actions">
                {art.type !== 'imperfect_extraction' && (
                  <button
                    className="btn btn-approve btn-sm"
                    disabled={loading}
                    onClick={() => onDecide(crit.id, 'approve', { edit: editBody })}
                  >✓ Approve</button>
                )}
                <button
                  className="btn btn-dismiss btn-sm"
                  disabled={loading}
                  onClick={() => onDecide(crit.id, 'dismiss')}
                >
                  {art.type === 'imperfect_extraction' ? '✗ Dismiss bad extraction' : '✗ Dismiss'}
                </button>
              </div>
            </div>
          )}

          {art && artPending && art.type === 'targeted_question' && (
            <div className="artifact-section">
              <div className="artifact-title">{art.title}</div>
              <div className="artifact-body">{art.body}</div>
              <div className="answer-section">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Enter answer — stored as patient-reported, not auto-verified…"
                />
                <div className="patient-reported-label">
                  ◈ Will enter state as <strong>patient-reported</strong> — not clinician-verified
                </div>
                <button
                  className="btn btn-submit btn-sm"
                  disabled={loading || !answer.trim()}
                  onClick={() => onDecide(crit.id, 'answer', { answer })}
                >
                  Submit & replan →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PacketDrawer({ state, onClose }) {
  const facts = state?.packet?.facts || []
  const addenda = state?.packet?.approved_addenda || []
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <h2>Draft PA packet</h2>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <p style={{ fontSize: '.88rem', color: 'var(--slate)', marginBottom: '.75rem' }}>
            {state?.packet?.service_requested} · {state?.packet?.status?.replaceAll('_', ' ')}
          </p>
          {facts.length === 0 && (
            <p style={{ color: 'var(--slate)', fontSize: '.9rem' }}>
              Approve conversation-enriched addenda to populate the packet.
            </p>
          )}
          {facts.map((f, i) => (
            <div className="packet-fact" key={i}>
              <div className="pf-criterion">{f.criterion_label}</div>
              <div className="pf-quote">"{f.quoted_span}"</div>
              <div className="pf-source">{f.source_layer} · {f.source_location}</div>
            </div>
          ))}
          {addenda.length > 0 && (
            <>
              <p style={{ fontWeight: 700, fontSize: '.85rem', marginTop: '.85rem', marginBottom: '.4rem' }}>
                Approved addenda
              </p>
              {addenda.map((a) => (
                <div className="packet-addendum" key={a.id}>{a.body}</div>
              ))}
            </>
          )}
          <div className="drawer-disclaimer">{state?.packet?.disclaimer}</div>
        </div>
      </div>
    </>
  )
}

function LogDrawer({ tuples, onClose }) {
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <h2>Trajectory log</h2>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <p style={{ fontSize: '.82rem', color: 'var(--slate)', marginBottom: '.75rem' }}>
            state_before → action → human_decision → state_after
            <br />logged to <code>backend/logs/tuples.jsonl</code>
          </p>
          {tuples.length === 0 && (
            <p style={{ color: 'var(--slate)', fontSize: '.9rem' }}>
              HITL decisions append here.
            </p>
          )}
          {tuples.map((t, i) => (
            <div className="log-entry" key={i}>
              <span className="log-ts">{t.ts?.slice(11, 19)}</span>
              {' · '}
              {t.criterion_id}
              {' · '}
              <span className="log-change">{t.decision}</span>
              {t.answer ? ` · "${t.answer.slice(0, 55)}…"` : ''}
              {' → '}
              {t.state_after?.completeness?.score_pct ?? '?'}%
              {t.state_after?.recommended_action_type
                ? ` · next: ${t.state_after.recommended_action_type}`
                : ''}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function App() {
  const [encounters, setEncounters] = useState([])
  const [encounterId, setEncounterId] = useState('')
  const [liveMineAvailable, setLiveMineAvailable] = useState(false)
  const [state, setState] = useState(null)
  const [tuples, setTuples] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState(null) // 'packet' | 'log' | null

  useEffect(() => {
    ;(async () => {
      try {
        const [health, enc] = await Promise.all([api('/api/health'), api('/api/encounters')])
        setLiveMineAvailable(!!health.live_mine_available)
        setEncounters(enc.encounters || [])
        setEncounterId(enc.default_encounter_id || '')
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [])

  async function runAnalyze(live = false) {
    if (!encounterId) return
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ encounter_id: encounterId, session_id: SESSION, live_mine: live }),
      })
      setState(data.state)
      setTuples(data.tuples || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const onDecide = useCallback(
    async (criterionId, decision, extras = {}) => {
      setLoading(true)
      setError('')
      try {
        const data = await api('/api/decide', {
          method: 'POST',
          body: JSON.stringify({
            session_id: SESSION,
            criterion_id: criterionId,
            decision,
            ...extras,
          }),
        })
        setState(data.state)
        setTuples(data.tuples || [])
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const stage = deriveStage(state)
  const completeness = state?.completeness
  const lp = state?.layers_preview
  const metadata = lp?.metadata
  const criteria = state?.criteria || []

  const autoExpandStatuses = new Set(['conversation_enriched', 'partial', 'unknown'])

  return (
    <>
      <div className="app">
        {/* ── HEADER ── */}
        <header className="header">
          <div className="brand">
            <div className="brand-mark">P</div>
            <div>
              <h1>Praxess</h1>
              <div className="sub">Evidence from the room · Prior auth prep</div>
            </div>
          </div>
          <div className="header-controls">
            <select
              className="encounter-select"
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
            >
              {encounters.map((enc) => (
                <option key={enc.id} value={enc.id}>
                  {enc.curated ? '★ ' : ''}{enc.date} — {enc.visit_title}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              disabled={loading || !encounterId}
              onClick={() => runAnalyze(false)}
            >
              {loading ? 'Working…' : 'Run agent'}
            </button>
            <button
              className="btn btn-ghost"
              disabled={loading || !encounterId || !liveMineAvailable}
              onClick={() => runAnalyze(true)}
              title={liveMineAvailable ? 'Re-mine with Claude' : 'Set ANTHROPIC_API_KEY to enable'}
            >
              Re-mine
            </button>
          </div>
        </header>

        {error && <div className="error-bar">{error}</div>}

        {/* ── CASE STRIP + STAGE TRACKER ── */}
        {state && metadata && (
          <div className="case-strip">
            <div className="case-meta">
              <div className="patient">{metadata.visit_title}</div>
              <div className="visit">{metadata.date}</div>
              <div className="service">{state.policy?.service}</div>
            </div>
            <StageTracker stage={stage} />
          </div>
        )}

        {/* ── EMPTY STATE ── */}
        {!state && (
          <div className="empty-state">
            Select a curated encounter (★) and click <strong>Run agent</strong>.
            <div className="hint">Default: 2021 chronic low back pain — ibuprofen trial gap</div>
          </div>
        )}

        {/* ── WORLD MODEL VIZ ── */}
        {state && (
          <div className="world-model">
            <div className="wm-label">Evidence sources</div>

            {/* Row 1 — source chips */}
            <div className="sources-row">
              <SourceChip
                icon="🎙"
                name="Transcript"
                meta={`${lp?.transcript_words ?? '—'} words · ambient visit recording`}
                content={state.transcript?.slice(0, 600) + '…'}
              />
              <SourceChip
                icon="📄"
                name="Clinical note"
                meta={`${lp?.note_words ?? '—'} words · SOAP-style`}
                content={state.note?.slice(0, 600) + '…'}
              />
              <SourceChip
                icon="🔵"
                name="FHIR"
                meta={`${lp?.fhir_resource_count ?? '—'} resources · encounter + longitudinal`}
                badge={lp?.fhir_lbp_gap ? '⚠ LBP gap' : null}
                content={state.fhir_text?.slice(0, 600) + '…'}
              />
            </div>

            {/* Arrow 1 */}
            <div className="wm-connector">
              <div className="wm-connector-line" />
              <div className="wm-connector-label">mined across 3 layers</div>
              <div className="wm-connector-arrow">▼</div>
            </div>

            {/* Row 2 — current evidence state */}
            <div className="state-row">
              <div className="state-row-head">
                <span className="state-row-title">Current evidence state</span>
                <span style={{ fontSize: '.8rem', color: 'var(--slate)' }}>
                  {completeness?.addressed ?? 0}/{completeness?.total ?? 0} addressed
                </span>
              </div>
              <div style={{ marginTop: '.45rem' }}>
                <StateChips completeness={completeness} />
              </div>
              {state.fhir_gap_callout && (
                <div style={{ marginTop: '.5rem' }}>
                  <span className="fhir-gap-badge">
                    ⚠ {state.fhir_gap_callout.title}: {state.fhir_gap_callout.detail}
                  </span>
                </div>
              )}
            </div>

            {/* Arrow 2 */}
            <div className="wm-connector">
              <div className="wm-connector-line" />
              <div className="wm-connector-label">highest-value action</div>
              <div className="wm-connector-arrow">▼</div>
            </div>

            {/* Row 3 — recommended action */}
            <RecommendedAction
              action={state.case_recommended_action}
              onDecide={onDecide}
              loading={loading}
            />
          </div>
        )}

        {/* ── CRITERIA CARDS ── */}
        {criteria.length > 0 && (
          <div className="criteria-section">
            <div className="criteria-label">Criteria — click to inspect evidence</div>
            <div className="criteria-list">
              {criteria.map((c) => (
                <CriterionCard
                  key={c.id}
                  crit={c}
                  autoExpand={autoExpandStatuses.has(c.status)}
                  onDecide={onDecide}
                  loading={loading}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── STICKY FOOTER ── */}
      {state && (
        <div className="footer-bar">
          <div className="footer-inner">
            <div className="footer-score">
              <div>
                <div className="score-num">{completeness?.score_pct ?? 0}%</div>
                <div className="score-label">addressed</div>
              </div>
              <div className="score-chips">
                {(completeness?.addressed ?? 0) > 0 && (
                  <span className="score-chip addressed">✓ {completeness.addressed} documented</span>
                )}
                {(completeness?.recoverable ?? 0) > 0 && (
                  <span className="score-chip recoverable">◉ {completeness.recoverable} enriched/partial</span>
                )}
                {(completeness?.patient_reported ?? 0) > 0 && (
                  <span className="score-chip patient_rep">◈ {completeness.patient_reported} patient-reported</span>
                )}
                {(completeness?.open ?? 0) > 0 && (
                  <span className="score-chip open">? {completeness.open} open</span>
                )}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${completeness?.score_pct ?? 0}%` }} />
              </div>
            </div>
            <div className="footer-actions">
              <button className="btn btn-packet btn-sm" onClick={() => setDrawer('packet')}>
                Packet ▸
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDrawer('log')}>
                Log ▸
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DRAWERS ── */}
      {drawer === 'packet' && (
        <PacketDrawer state={state} onClose={() => setDrawer(null)} />
      )}
      {drawer === 'log' && (
        <LogDrawer tuples={tuples} onClose={() => setDrawer(null)} />
      )}
    </>
  )
}
