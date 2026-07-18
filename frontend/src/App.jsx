import { useCallback, useEffect, useRef, useState } from 'react'
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
  SUBMIT_NOW: 'Submit now',
  PEER_TO_PEER: 'Peer-to-peer',
  ESCALATE: 'Escalate',
}

const ACTION_TYPE_ICON = {
  ASK_PATIENT: '👤',
  ASK_CLINICIAN: '🩺',
  DRAFT_ADDENDUM: '📝',
  HUMAN_REVIEW: '👁',
  REQUEST_RECORD: '📋',
  GENERATE_PACKET: '📦',
  SUBMIT_NOW: '→',
  PEER_TO_PEER: '📞',
  ESCALATE: '⚠',
}

const PERMISSION_LABEL = {
  autonomous: 'autonomous',
  human_approval: 'needs approval',
  human_only: 'human only',
}

// Curated card metadata shown on the select page
const CARD_META = {
  primary_lbp: {
    title: 'Chronic low back pain',
    date: 'Apr 2021',
    desc: '2 criteria need conversation evidence — ibuprofen trial gap in note',
    badge: 'Primary demo',
    badgeClass: 'primary',
  },
  htn_lbp: {
    title: 'Hypertension + low back pain',
    date: 'Jul 2025',
    desc: 'Mostly documented — use as control case to show clean flow',
    badge: 'Control',
    badgeClass: 'control',
  },
  knee_oa: {
    title: 'Knee osteoarthritis',
    date: 'Aug 2016',
    desc: '2 criteria unknown — demonstrates targeted question flow',
    badge: 'Alt scenario',
    badgeClass: 'alt',
  },
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

// ── TRAJECTORY PANEL ─────────────────────────────────────────
function QBar({ score, max = 12 }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100))
  const color = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--amber)' : 'var(--rose)'
  return (
    <div className="q-bar-wrap">
      <div className="q-bar-track">
        <div className="q-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="q-bar-label" style={{ color }}>{score.toFixed(1)}</span>
    </div>
  )
}

function TrajectoryRow({ t, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`traj-row ${t.recommended ? 'traj-recommended' : ''}`}>
      <button className="traj-row-head" onClick={() => setOpen(o => !o)}>
        <span className="traj-rank">{t.recommended ? '★' : t.rank}</span>
        <span className="traj-icon">{ACTION_TYPE_ICON[t.action_type] || '→'}</span>
        <span className="traj-label">{t.label}</span>
        <div className="traj-metrics">
          <QBar score={t.q_score} />
          <span className="traj-metric appr">{Math.round(t.approval_likelihood * 100)}%</span>
          <span className="traj-metric days">{t.days_to_care}d</span>
          <span className={`traj-permission ${t.permission}`}>{PERMISSION_LABEL[t.permission]}</span>
        </div>
        <span className={`traj-toggle ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="traj-body">
          <div className="traj-outcome">{t.predicted_outcome}</div>
          <div className="traj-detail-grid">
            <div className="traj-detail-cell">
              <div className="tdc-label">Why {t.recommended ? 'recommended' : 'considered'}</div>
              <div className="tdc-value">{t.recommended ? t.why : t.why}</div>
            </div>
            <div className="traj-detail-cell">
              <div className="tdc-label">Counterfactual</div>
              <div className="tdc-value">{t.counterfactual}</div>
            </div>
          </div>
          <div className="traj-scores-row">
            <TrajScorePill label="Approval" value={`${Math.round(t.approval_likelihood * 100)}%`} color="green" />
            <TrajScorePill label="Days to care" value={`${t.days_to_care}d`} color="amber" />
            <TrajScorePill label="Clinical risk" value={`${Math.round(t.clinical_risk * 100)}%`} color="rose" />
            <TrajScorePill label="Staff burden" value={`${Math.round(t.staff_burden * 100)}%`} color="slate" />
            <TrajScorePill label="ΔUncertainty" value={`${Math.round(t.uncertainty_reduction * 100)}%`} color="blue" />
          </div>
        </div>
      )}
    </div>
  )
}

function TrajScorePill({ label, value, color }) {
  return (
    <div className={`traj-score-pill color-${color}`}>
      <span className="tsp-label">{label}</span>
      <span className="tsp-value">{value}</span>
    </div>
  )
}

function TrajectoryPanel({ trajectories }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!trajectories?.trajectories?.length) return null

  const { trajectories: rolls, model_note, phase } = trajectories
  const winner = rolls[0]

  const phaseLabel = {
    initial: 'Initial — open criteria present',
    patient_answered: 'Patient answered — record retrieval phase',
    ready_to_submit: 'Ready — all criteria addressed',
    heuristic: 'Heuristic mode',
  }[phase] || phase

  return (
    <div className="traj-panel">
      <button className="traj-panel-header" onClick={() => setCollapsed(c => !c)}>
        <div className="traj-panel-title">
          <span className="traj-panel-icon">⟳</span>
          Trajectory simulation
          <span className="traj-phase-badge">{phaseLabel}</span>
        </div>
        <div className="traj-panel-meta">
          <span className="traj-model-tag">Heuristic prior · improving with outcomes</span>
          <span className={`traj-panel-toggle ${collapsed ? '' : 'open'}`}>▾</span>
        </div>
      </button>

      {!collapsed && (
        <div className="traj-panel-body">
          {/* Winner callout */}
          <div className="traj-winner">
            <div className="traj-winner-head">
              <span className="tw-star">★</span>
              <span className="tw-label">Winning trajectory</span>
              <span className="tw-action">{ACTION_TYPE_LABEL[winner.action_type] || winner.action_type}: {winner.label}</span>
            </div>
            <div className="tw-outcome">{winner.predicted_outcome}</div>
          </div>

          {/* All trajectories */}
          <div className="traj-list">
            <div className="traj-list-head">
              <span style={{ flex: 1 }}>Action</span>
              <span className="traj-col-head">Q-score</span>
              <span className="traj-col-head">Approval</span>
              <span className="traj-col-head">Days</span>
              <span className="traj-col-head">Permission</span>
            </div>
            {rolls.map(t => (
              <TrajectoryRow key={t.id} t={t} defaultOpen={t.recommended} />
            ))}
          </div>

          <div className="traj-model-note">{model_note}</div>
        </div>
      )}
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


// ── RECOMMENDED ACTION CARD ─────────────────────────────────
function RecommendedAction({ action, onDecide, loading, large }) {
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
      <div className={`action-complete${large ? '' : ' ra-complete-inline'}`}>
        {large ? (
          <>
            <div className="ac-icon">✓</div>
            <h2>All criteria addressed</h2>
            <p>Open the packet drawer to review the provenance-linked draft summary.</p>
          </>
        ) : (
          <span>✓ All criteria addressed — open the packet drawer to review the draft summary.</span>
        )}
      </div>
    )
  }

  const isQuestion =
    action.artifact_type === 'targeted_question' && action.artifact_status === 'pending_answer'
  const isImperfect = action.artifact_type === 'imperfect_extraction'

  return (
    <div className={`recommended-action${large ? ' action-page' : ''}`}>
      <div className="ra-header">
        <span className="ra-title">{action.title}</span>
        <span className="ra-type">{ACTION_TYPE_LABEL[action.type] || action.type}</span>
      </div>
      {!isQuestion && (
        <div className="ra-body">{large ? edit : action.body}</div>
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
          <div className="patient-reported-label">
            ◈ Will enter state as <strong>patient-reported</strong> — not clinician-verified
          </div>
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
          {large && !isImperfect && (
            <textarea
              className="artifact-edit"
              style={{ marginTop: '.65rem' }}
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
            />
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

// ── CRITERION CARD ───────────────────────────────────────────
function CriterionCard({ crit, autoExpand, onDecide, loading }) {
  const [open, setOpen] = useState(autoExpand)
  const [editBody, setEditBody] = useState(crit.artifact?.body || '')
  const [answer, setAnswer] = useState('')

  useEffect(() => {
    setEditBody(crit.artifact?.body || '')
    setAnswer('')
  }, [crit.id, crit.artifact?.status])

  const art = crit.artifact
  const artPending = art && ['pending_approval', 'pending_answer'].includes(art.status)

  return (
    <div className={`criterion-card status-${crit.status}`}>
      <button
        className={`criterion-header ${open ? 'expanded' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ch-icon">{STATUS_ICON[crit.status] || '?'}</span>
        <span className="ch-label">{crit.label}</span>
        <span className={`status-pill ${crit.status}`}>{STATUS_LABEL[crit.status] || crit.status}</span>
        <span className={`ch-toggle ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="criterion-body">
          <div className="crit-summary-text">{crit.summary}</div>

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

          {art && !artPending && (
            <div className="artifact-section">
              <div className="artifact-title">
                {art.title}
                <span className={`artifact-badge ${art.status}`}>{art.status}</span>
              </div>
              {art.answer && <div className="artifact-body">Answer recorded: {art.answer}</div>}
              {art.status === 'approved' && art.body && (
                <div className="artifact-body">{art.body}</div>
              )}
            </div>
          )}

          {art && artPending && art.type !== 'targeted_question' && (
            <div className="artifact-section">
              <div className="artifact-title">
                {art.title}
                <span className={`artifact-badge ${art.type === 'imperfect_extraction' ? 'imperfect' : ''}`}>
                  {art.type === 'imperfect_extraction' ? 'review' : 'draft'}
                </span>
              </div>
              <textarea className="artifact-edit" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
              <div className="artifact-actions">
                {art.type !== 'imperfect_extraction' && (
                  <button className="btn btn-approve btn-sm" disabled={loading}
                    onClick={() => onDecide(crit.id, 'approve', { edit: editBody })}>✓ Approve</button>
                )}
                <button className="btn btn-dismiss btn-sm" disabled={loading}
                  onClick={() => onDecide(crit.id, 'dismiss')}>
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
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Enter answer — stored as patient-reported, not auto-verified…" />
                <div className="patient-reported-label">
                  ◈ Will enter state as <strong>patient-reported</strong> — not clinician-verified
                </div>
                <button className="btn btn-submit btn-sm" disabled={loading || !answer.trim()}
                  onClick={() => onDecide(crit.id, 'answer', { answer })}>Submit & replan →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── DRAWERS ──────────────────────────────────────────────────
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
              <p style={{ fontWeight: 700, fontSize: '.85rem', marginTop: '.85rem', marginBottom: '.4rem' }}>Approved addenda</p>
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
            <p style={{ color: 'var(--slate)', fontSize: '.9rem' }}>HITL decisions append here.</p>
          )}
          {tuples.map((t, i) => (
            <div className="log-entry" key={i}>
              <span className="log-ts">{t.ts?.slice(11, 19)}</span>
              {' · '}{t.criterion_id}{' · '}
              <span className="log-change">{t.decision}</span>
              {t.answer ? ` · "${t.answer.slice(0, 55)}…"` : ''}
              {' → '}{t.state_after?.completeness?.score_pct ?? '?'}%
              {t.state_after?.recommended_action_type ? ` · next: ${t.state_after.recommended_action_type}` : ''}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── PAGE R: RECORD ───────────────────────────────────────────
function RecordPage({ onBack, onAnalyze, loading }) {
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [note, setNote] = useState('')
  const [supported, setSupported] = useState(true)
  const recognitionRef = useRef(null)

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSupported(false); return }
    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.onresult = (e) => {
      let fin = ''
      let int = ''
      for (const res of Array.from(e.results)) {
        if (res.isFinal) fin += res[0].transcript + ' '
        else int += res[0].transcript
      }
      if (fin) setTranscript((t) => t + fin)
      setInterimText(int)
    }
    r.onerror = (e) => {
      if (e.error !== 'no-speech') console.warn('SR error', e.error)
    }
    r.onend = () => {
      setRecording(false)
      setInterimText('')
    }
    recognitionRef.current = r
    return () => { r.abort() }
  }, [])

  function toggleRecording() {
    const r = recognitionRef.current
    if (!r) return
    if (recording) {
      r.stop()
      setRecording(false)
    } else {
      r.start()
      setRecording(true)
    }
  }

  const fullText = transcript + interimText
  const wordCount = fullText.trim() ? fullText.trim().split(/\s+/).length : 0
  const canAnalyze = fullText.trim().length >= 20

  return (
    <div className="page-record page-content">
      <div className="page-nav">
        <button className="nav-back" onClick={onBack}>← Back</button>
        <div className="nav-crumb"><strong>Record conversation</strong></div>
      </div>

      <div className="rec-header">
        <div className="rec-title">Record a patient conversation</div>
        <div className="rec-sub">
          Press the microphone to begin. Speech is transcribed live in your browser
          — nothing leaves your device until you click "Analyze →".
          {!supported && ' (Web Speech API not available in this browser — type the transcript manually below.)'}
        </div>
      </div>

      {/* Mic button */}
      {supported && (
        <div className="rec-mic-area">
          <button
            className={`mic-btn ${recording ? 'recording' : ''}`}
            onClick={toggleRecording}
            title={recording ? 'Stop recording' : 'Start recording'}
          >
            {recording ? '⏹' : '🎙'}
          </button>
          <div className={`mic-status ${recording ? 'live' : ''}`}>
            {recording ? '● Recording…' : transcript ? 'Recording stopped' : 'Click to start recording'}
          </div>
        </div>
      )}

      {/* Live transcript */}
      <div className="rec-tx-label">
        <span>Live transcript</span>
        <span className="tx-word-count">{wordCount} words</span>
      </div>
      <div
        className="rec-live-tx"
        contentEditable={!recording}
        suppressContentEditableWarning
        onBlur={(e) => setTranscript(e.currentTarget.textContent || '')}
      >
        {fullText
          ? <>{transcript}<em style={{ color: 'var(--slate)' }}>{interimText}</em>{recording && <span className="tx-cursor" />}</>
          : <span className="tx-placeholder">Transcript will appear here… or type / paste manually.</span>
        }
      </div>

      {/* Optional note */}
      <div className="rec-note-label">Clinical note (optional — paste or type)</div>
      <textarea
        className="rec-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Paste the SOAP note here if available — improves evidence grounding…"
      />

      {!canAnalyze && fullText.length > 0 && (
        <div className="rec-warning">Transcript too short — speak or type at least a few sentences.</div>
      )}

      <div className="rec-actions">
        <button
          className="btn btn-record-analyze"
          disabled={loading || !canAnalyze}
          onClick={() => onAnalyze(transcript + interimText, note)}
        >
          {loading ? 'Analyzing…' : 'Analyze this conversation →'}
        </button>
        <button className="btn btn-ghost" onClick={() => { setTranscript(''); setNote('') }}>
          Clear
        </button>
      </div>
    </div>
  )
}

// ── PAGE 1: SELECT ───────────────────────────────────────────
function SelectPage({ encounters, onSelect, onRecord, loading }) {
  const curated = encounters.filter((e) => e.curated)
  const rest = encounters.filter((e) => !e.curated)

  // Map curated encounters to card metadata by matching visit_title keywords
  function cardMeta(enc) {
    const t = enc.visit_title?.toLowerCase() || ''
    if (t.includes('hypertension') || t.includes('htn')) return CARD_META.htn_lbp
    if (t.includes('osteoarthr') || t.includes('knee')) return CARD_META.knee_oa
    return CARD_META.primary_lbp // default: primary LBP
  }

  return (
    <div className="page-select page-content">
      {/* Hero */}
      <div className="select-hero">
        <div className="eyebrow">Praxess · Hackathon demo</div>
        <h1>Evidence from the room</h1>
        <p className="tagline">
          Mines ambient visit transcripts, clinical notes, and FHIR for prior auth evidence —
          verifies every span, closes the documentation gap.
        </p>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 1.25rem 4rem' }}>
        <div className="cases-label">Curated demo cases</div>
        <div className="encounter-cards">
          {curated.map((enc) => {
            const m = cardMeta(enc)
            return (
              <div key={enc.id} className={`encounter-card${m === CARD_META.primary_lbp ? ' primary' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="card-star">★ Curated</span>
                  <span className="card-date">{enc.date?.slice(0, 7)}</span>
                </div>
                <div className="card-title">{m.title}</div>
                <div className="card-service">Lumbar MRI · prior auth</div>
                <div className="card-desc">{m.desc}</div>
                <button
                  className="card-cta"
                  disabled={loading}
                  onClick={() => onSelect(enc.id)}
                >
                  {loading ? 'Loading…' : 'Run agent →'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Record live conversation card */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="cases-label" style={{ marginTop: '.75rem' }}>Or record a new conversation</div>
          <div
            className="encounter-card record-card"
            style={{ maxWidth: 340, cursor: 'pointer' }}
            onClick={onRecord}
          >
            <span className="card-star">🎙 Live</span>
            <div className="card-title">Record patient conversation</div>
            <div className="card-service">Any case · transcript-only</div>
            <div className="card-desc">
              Speak or paste a transcript from today's visit — agent mines it against
              the lumbar MRI policy in real time.
            </div>
            <button className="card-cta" disabled={loading} onClick={(e) => { e.stopPropagation(); onRecord() }}>
              Open recorder →
            </button>
          </div>
        </div>

        <details className="browse-all">
          <summary>
            <span>▸</span>
            Browse all {rest.length} additional encounters from synthetic-ambient-fhir-25
          </summary>
          <div className="browse-all-grid">
            {rest.map((enc) => (
              <button key={enc.id} className="browse-row" disabled={loading} onClick={() => onSelect(enc.id)}>
                <div>
                  <div className="br-title">{enc.visit_title?.slice(0, 48) || enc.id.slice(0, 16)}</div>
                  <div className="br-date">{enc.date}</div>
                </div>
                <span className="br-arrow">→</span>
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}

// ── PAGE 2: EVIDENCE ─────────────────────────────────────────
function EvidencePage({ state, trajectories, onDecide, loading, onBack, onGoAction, setDrawer, liveMineAvailable, onRemine }) {
  const stage = deriveStage(state)
  const completeness = state?.completeness
  const lp = state?.layers_preview
  const metadata = lp?.metadata
  const criteria = state?.criteria || []
  const autoExpandStatuses = new Set(['conversation_enriched', 'partial', 'unknown'])

  return (
    <div className="app page-content">
      {/* Nav */}
      <div className="page-nav">
        <button className="nav-back" onClick={onBack}>← Back</button>
        <div className="nav-crumb">
          <strong>{metadata?.visit_title?.slice(0, 55) || 'Encounter'}</strong>
          {metadata?.date ? ` · ${metadata.date}` : ''}
        </div>
        {liveMineAvailable && (
          <button className="btn btn-ghost btn-sm" disabled={loading} onClick={onRemine}
            title="Re-mine with Claude (live)">Re-mine ↺</button>
        )}
      </div>

      {/* Case strip + Stage tracker */}
      <div className="case-strip">
        <div className="case-meta">
          <div className="patient">{metadata?.visit_title}</div>
          <div className="visit">{metadata?.date}</div>
          <div className="service">{state.policy?.service}</div>
        </div>
        <StageTracker stage={stage} />
      </div>

      {/* World model */}
      <div className="world-model">
        <div className="wm-label">Evidence sources</div>
        <div className="sources-row">
          <SourceChip icon="🎙" name="Transcript"
            meta={`${lp?.transcript_words ?? '—'} words · ambient visit recording`}
            content={state.transcript?.slice(0, 600) + '…'} />
          <SourceChip icon="📄" name="Clinical note"
            meta={`${lp?.note_words ?? '—'} words · SOAP-style`}
            content={state.note?.slice(0, 600) + '…'} />
          <SourceChip icon="🔵" name="FHIR"
            meta={`${lp?.fhir_resource_count ?? '—'} resources · encounter + longitudinal`}
            badge={lp?.fhir_lbp_gap ? '⚠ LBP gap' : null}
            content={state.fhir_text?.slice(0, 600) + '…'} />
        </div>
        <div className="wm-connector">
          <div className="wm-connector-line" />
          <div className="wm-connector-label">mined across 3 layers</div>
          <div className="wm-connector-arrow">▼</div>
        </div>
        <div className="state-row">
          <div className="state-row-head">
            <span className="state-row-title">Current evidence state</span>
            <span style={{ fontSize: '.8rem', color: 'var(--slate)' }}>
              {completeness?.addressed ?? 0}/{completeness?.total ?? 0} addressed
            </span>
          </div>
          <div style={{ marginTop: '.45rem' }}><StateChips completeness={completeness} /></div>
          {state.fhir_gap_callout && (
            <div style={{ marginTop: '.5rem' }}>
              <span className="fhir-gap-badge">⚠ {state.fhir_gap_callout.title}: {state.fhir_gap_callout.detail}</span>
            </div>
          )}
        </div>
        <div className="wm-connector">
          <div className="wm-connector-line" />
          <div className="wm-connector-label">trajectory simulation</div>
          <div className="wm-connector-arrow">▼</div>
        </div>
        <TrajectoryPanel trajectories={trajectories} />
        <div className="wm-connector">
          <div className="wm-connector-line" />
          <div className="wm-connector-label">highest-value action</div>
          <div className="wm-connector-arrow">▼</div>
        </div>
        <RecommendedAction action={state.case_recommended_action} onDecide={onDecide} loading={loading} />      </div>

      {/* Criteria cards */}
      {criteria.length > 0 && (
        <div className="criteria-section">
          <div className="criteria-label">Criteria — click to inspect evidence</div>
          <div className="criteria-list">
            {criteria.map((c) => (
              <CriterionCard key={c.id} crit={c}
                autoExpand={autoExpandStatuses.has(c.status)}
                onDecide={onDecide} loading={loading} />
            ))}
          </div>
        </div>
      )}

      {/* Sticky footer */}
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
            <button className="btn btn-action btn-sm" onClick={onGoAction}>
              Take action →
            </button>
            <button className="btn btn-packet btn-sm" onClick={() => setDrawer('packet')}>Packet ▸</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDrawer('log')}>Log ▸</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── PAGE 3: ACTION ───────────────────────────────────────────
function ActionPage({ state, trajectories, onDecide, loading, onBack, setDrawer }) {
  const stage = deriveStage(state)
  const completeness = state?.completeness
  const criteria = state?.criteria || []
  const action = state?.case_recommended_action
  const isComplete = action?.type === 'GENERATE_PACKET' || !action

  return (
    <div className="page-action page-content">
      {/* Nav */}
      <div className="page-nav">
        <button className="nav-back" onClick={onBack}>← Evidence</button>
        <div className="nav-crumb">
          <strong>{state?.layers_preview?.metadata?.visit_title?.slice(0, 55) || 'Encounter'}</strong>
        </div>
        <StageTracker stage={stage} />
      </div>

      {/* Main action */}
      <div className="action-hero-label">Recommended next action</div>
      {isComplete ? (
        <div className="action-complete">
          <div className="ac-icon">✓</div>
          <h2>All criteria addressed</h2>
          <p>Open the packet drawer to review the provenance-linked draft summary.</p>
          <button className="btn btn-primary" onClick={() => setDrawer('packet')}>
            View packet →
          </button>
        </div>
      ) : (
        <>
          <TrajectoryPanel trajectories={trajectories} />
          <RecommendedAction action={action} onDecide={onDecide} loading={loading} large />
        </>
      )}

      {/* Mini state — criteria chips */}
      <div className="mini-state">
        <div className="mini-state-title">Case state</div>
        <div className="mini-criteria">
          {criteria.map((c) => (
            <div key={c.id} className="mini-criterion">
              <span className="mc-icon">{STATUS_ICON[c.status] || '?'}</span>
              <span className="mc-label">{c.label}</span>
              <span className={`status-pill mc-status ${c.status}`}>
                {STATUS_LABEL[c.status] || c.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
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
            <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
            <button className="btn btn-packet btn-sm" onClick={() => setDrawer('packet')}>Packet ▸</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDrawer('log')}>Log ▸</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ROOT APP ─────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('select') // 'select' | 'record' | 'evidence' | 'action'
  const [encounters, setEncounters] = useState([])
  const [liveMineAvailable, setLiveMineAvailable] = useState(false)
  const [state, setState] = useState(null)
  const [trajectories, setTrajectories] = useState(null)
  const [tuples, setTuples] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState(null) // 'packet' | 'log'

  useEffect(() => {
    ;(async () => {
      try {
        const [health, enc] = await Promise.all([api('/api/health'), api('/api/encounters')])
        setLiveMineAvailable(!!health.live_mine_available)
        setEncounters(enc.encounters || [])
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [])

  async function runAnalyze(encId, live = false) {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ encounter_id: encId, session_id: SESSION, live_mine: live }),
      })
      setState(data.state)
      setTuples(data.tuples || [])
      setTrajectories(data.trajectories || null)
      setPage('evidence')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const onDecide = useCallback(async (criterionId, decision, extras = {}) => {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/decide', {
        method: 'POST',
        body: JSON.stringify({ session_id: SESSION, criterion_id: criterionId, decision, ...extras }),
      })
      setState(data.state)
      setTuples(data.tuples || [])
      setTrajectories(data.trajectories || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  async function runAnalyzeTranscript(transcript, note) {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/analyze_transcript', {
        method: 'POST',
        body: JSON.stringify({ transcript, note: note || '', session_id: SESSION }),
      })
      setState(data.state)
      setTuples(data.tuples || [])
      setTrajectories(data.trajectories || null)
      setPage('evidence')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {error && <div className="error-bar" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 }}>{error} <button onClick={() => setError('')}>✕</button></div>}

      {page === 'select' && (
        <SelectPage
          encounters={encounters}
          loading={loading}
          onSelect={(id) => runAnalyze(id)}
          onRecord={() => setPage('record')}
        />
      )}

      {page === 'record' && (
        <RecordPage
          loading={loading}
          onBack={() => setPage('select')}
          onAnalyze={runAnalyzeTranscript}
        />
      )}

      {page === 'evidence' && state && (
        <EvidencePage
          state={state}
          trajectories={trajectories}
          onDecide={onDecide}
          loading={loading}
          onBack={() => setPage('select')}
          onGoAction={() => setPage('action')}
          setDrawer={setDrawer}
          liveMineAvailable={liveMineAvailable}
          onRemine={() => {
            const id = state?.encounter_id
            if (id) runAnalyze(id, true)
          }}
        />
      )}

      {page === 'action' && state && (
        <ActionPage
          state={state}
          trajectories={trajectories}
          onDecide={onDecide}
          loading={loading}
          onBack={() => setPage('evidence')}
          setDrawer={setDrawer}
        />
      )}

      {drawer === 'packet' && <PacketDrawer state={state} onClose={() => setDrawer(null)} />}
      {drawer === 'log' && <LogDrawer tuples={tuples} onClose={() => setDrawer(null)} />}
    </>
  )
}
