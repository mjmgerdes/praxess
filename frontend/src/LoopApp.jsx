// LoopApp — native React port of the Claude Design 7-screen closed-loop UI.
// Ported per design_handoff_praxess/README.md: the .dc file is the spec, this is
// the recreation in the app's stack. The design's logic class runs VERBATIM below
// (state machine, decision engine, live /api wiring); the template was converted
// mechanically from the spec's HTML. Pixel fidelity comes from the spec's own
// inline oklch() styles, parsed at runtime by css().
import React, { useReducer, useRef, useState, useEffect, useCallback } from 'react';
import CaseConstellation from './CaseConstellation.jsx';
import DecisionRollout from './DecisionRollout.jsx';
import { buildPacketPdf } from './packetPdf.js';
import { buildAppealPdf } from './appealPdf.js';
import { apiFetch, apiBase } from './api.js';
import './loop.css';

// ---- tiny runtime the verbatim class needs (in place of the .dc runtime) ----
class DCLogic {}

const _cssCache = new Map();

// The design handoff was authored at dollhouse scale (9-13px everywhere).
// Remap font sizes upward toward a readable floor while preserving the
// hierarchy: sizes >= 15px are design sizes and pass through untouched.
function readableFontSize(v) {
  const m = /^([\d.]+)px$/.exec(v);
  if (!m) return v;
  const size = parseFloat(m[1]);
  if (size >= 15) return v;
  return Math.round((size + (15 - size) * 0.4) * 2) / 2 + 'px';
}

function css(str) {
  let o = _cssCache.get(str);
  if (o) return o;
  o = {};
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    let v = decl.slice(i + 1).trim();
    if (!k || !v) continue;
    if (k === 'font-size') v = readableFontSize(v);
    o[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  _cssCache.set(str, o);
  return o;
}

function useDC(Cls) {
  const [, force] = useReducer((x) => x + 1, 0);
  const ref = useRef(null);
  if (!ref.current) {
    const inst = new Cls();
    inst.setState = (patch) => {
      const p = typeof patch === 'function' ? patch(inst.state) : patch;
      inst.state = { ...inst.state, ...p };
      force();
    };
    ref.current = inst;
  }
  return ref.current;
}

// ---- design spec logic, verbatim from the handoff prototype ----
class Component extends DCLogic {
  state = {
    screen: 'encounter',
    steps: {
      addendumApproved: false,
      patientAsked: false,
      outreachChannel: 'sms',    // sms | voice | link — how the question reaches the patient
      outreachApproved: false,   // HITL go-ahead: nothing sends without it
      patientAnswered: false,
      recordRequested: false,
      recordReceived: false,
      packetGenerated: false,
      submitted: false,
      payerResponse: null,
      appealLetterApproved: false,
      p2pPrepped: false,
      appealSubmitted: false,
      denialReason: '',          // WHY, from the payer's denial letter (provider-entered)
      denialRef: '',             // payer's denial reference number
    },
    engine: 'connecting',      // live | offline | connecting — honest indicator of backend link
    engineCriteria: null,      // criterion_id -> status from /api/analyze_transcript
    priors: null,              // world-model priors (fit from the 25-encounter corpus; flywheel-refit)
    payerIntel: null,          // payer requirements synced from the coverage API
    liveTranscript: null,      // inline-recorded transcript (Abhay's inline record flow)
    liveNote: null,
    liveGapCallout: null,
    addendumText: `During the encounter, the patient reported using ibuprofen with good effect until the supply ran out several months ago, alongside walking and hot showers for symptom relief. The exact duration of this self-directed conservative care was not established during this visit.`,
    addendumEditing: false,
    visits: [],                // dated encounters from /api/encounters
    selectedVisitId: null,     // visit whose transcript is being viewed
    analyzedVisitId: null,     // visit the current case state was analyzed from
  };

  set(patch) { this.setState(s => ({ steps: { ...s.steps, ...patch } })); }
  go(screen) { this.setState({ screen }); }

  // ---- dated-visit browser: view any encounter's transcript; analyze on demand ----
  selectVisit(id) {
    if (!id || id === this.state.selectedVisitId) return;
    this.setState({ selectedVisitId: id });
    this.api('encounter?encounter_id=' + encodeURIComponent(id))
      .then(res => this.setState({ liveTranscript: res.transcript || null, liveNote: res.note || null }))
      .catch(() => {});
  }

  analyzeVisit(id) {
    if (!id) return;
    this.setState({ engine: 'connecting' });
    this.api('analyze', { encounter_id: id, session_id: 'design', live_mine: false })
      .then(res => {
        this._applyState(res);
        this.setState({
          analyzedVisitId: id,
          steps: { addendumApproved: false, patientAsked: false, patientAnswered: false, recordRequested: false, recordReceived: false, packetGenerated: false, submitted: false, payerResponse: null, appealLetterApproved: false, p2pPrepped: false, appealSubmitted: false },
        });
      })
      .catch(() => this.setState({ engine: 'offline' }));
  }

  // ---- live engine bridge (FastAPI backend via vite /api proxy in dev, VITE_API_URL in prod) ----
  api(path, body) {
    return apiFetch(path, body);
  }

  _applyState(res) {
    const st = res.state || res;
    const by = {};
    (st.criteria || []).forEach(c => { by[c.id] = c.status; });
    this.setState({
      engine: 'live',
      engineCriteria: by,
      liveTranscript: st.transcript || null,
      liveNote: st.note || null,
      liveGapCallout: st.fhir_gap_callout || null,
    });
  }

  boot() {
    if (this._booted) return; this._booted = true;
    const ENC = '1ba8eeb9-bc93-7129-4390-0d2ddd560616::1ba8eeb9-bc93-7129-2e7d-8c427e72b964';
    this.api('analyze', { encounter_id: ENC, session_id: 'design', live_mine: false })
      .then(res => this._applyState(res))
      .catch(() => this.setState({ engine: 'offline' }));
    this.api('encounters')
      .then(res => this.setState({ visits: res.encounters || [], selectedVisitId: ENC, analyzedVisitId: ENC }))
      .catch(() => {});
    // World-model priors + payer intel: static artifacts refreshed by the cron
    // jobs in ops/CRON.md; the UI reads whatever the last sync produced.
    fetch('/model/world_model_priors.json').then(r => r.json())
      .then(priors => this.setState({ priors })).catch(() => {});
    fetch('/model/payer-intel.json').then(r => r.json())
      .then(payerIntel => this.setState({ payerIntel })).catch(() => {});
  }

  // ---- value function: EV(a|s) = wA·ΔP(approve) + wI·infoGain − wT·delay/30d − wB·burden ----
  // Weights + per-action transition estimates come from the fitted priors
  // (scripts/train_world_model.py) and are refit weekly from the flywheel log.
  // `mods` conditions the estimate on the CURRENT state (e.g. asking the
  // patient before the note gap closes halves the info yield) — that state-
  // dependence is what makes it a rollout rather than a lookup.
  computeEV(actionKey, mods = {}) {
    const vf = this.state.priors?.value_function;
    const FALLBACK = { weights: { wApproval: 1, wInfo: 0.35, wTime: 0.25, wBurden: 0.15 }, actions: {} };
    const { weights, actions } = vf || FALLBACK;
    const a = (actions && actions[actionKey]) || { dPApprove: 0.1, infoGain: 0.2, delayDays: 1, burden: 0.2 };
    const dP = a.dPApprove * (mods.dP ?? 1);
    const info = a.infoGain * (mods.info ?? 1);
    const delay = a.delayDays * (mods.delay ?? 1);
    const burden = a.burden * (mods.burden ?? 1);
    const ev = weights.wApproval * dP + weights.wInfo * info - weights.wTime * (delay / 30) - weights.wBurden * burden;
    return {
      ev: Math.round(ev * 100) / 100,
      terms: `ΔP ${dP >= 0 ? '+' : ''}${dP.toFixed(2)} · info +${info.toFixed(2)} · delay ${delay.toFixed(1)}d · burden ${burden.toFixed(2)}`,
    };
  }

  decide(criterionId, decision, answer) {
    if (this.state.engine !== 'live') return;
    this.api('decide', { session_id: 'design', criterion_id: criterionId, decision, answer })
      .then(res => this._applyState(res))
      .catch(() => {});
  }

  mapStatus(s) {
    return {
      documented: 'documented', verified: 'verified',
      conversation_enriched: 'partial', partial: 'partial',
      patient_reported: 'patient', patient_reported_unverified: 'patient',
      unknown: 'unknown',
    }[s] || null;
  }

  liveStatus(id, fallback) {
    const by = this.state.engineCriteria || {};
    const m = by[id] != null ? this.mapStatus(by[id]) : null;
    return m || fallback;
  }

  // ---- criteria + status ----
  statusMeta(k) {
    const M = {
      documented: { label: 'Documented', color: 'oklch(0.45 0.1 155)', bg: 'oklch(0.96 0.03 155)', border: 'oklch(0.86 0.05 155)', w: 1 },
      verified:   { label: 'Verified',   color: 'oklch(0.45 0.1 155)', bg: 'oklch(0.96 0.03 155)', border: 'oklch(0.86 0.05 155)', w: 1 },
      partial:    { label: 'Partial',    color: 'oklch(0.5 0.1 300)',  bg: 'oklch(0.96 0.03 300)', border: 'oklch(0.87 0.04 300)', w: 0.5 },
      patient:    { label: 'Patient-reported', color: 'oklch(0.55 0.09 65)', bg: 'oklch(0.97 0.04 75)', border: 'oklch(0.88 0.05 75)', w: 0.6 },
      unknown:    { label: 'Unknown',    color: 'oklch(0.55 0.015 258)', bg: 'oklch(0.955 0.004 258)', border: 'oklch(0.9 0.006 258)', w: 0 },
    };
    return M[k] || M.unknown;
  }

  criteriaRaw() {
    const s = this.state.steps;
    // Post-action step flags win; otherwise the live engine's analyzed status; design default last.
    const c4 = s.addendumApproved ? 'documented' : this.liveStatus('conservative_care', 'partial');
    let c5 = this.liveStatus('functional_limitation', 'unknown');
    if (s.recordReceived) c5 = 'verified';
    else if (s.patientAnswered) c5 = 'patient';
    return [
      { id: 'C1', label: 'Symptom duration \u2265 6 weeks', status: this.liveStatus('symptom_duration', 'documented'), src: 'Clinical note \u00b7 FHIR' },
      { id: 'C2', label: 'Red-flag pathology absent', status: this.liveStatus('no_red_flags', 'documented'), src: 'Clinical note' },
      { id: 'C3', label: 'Documented neurologic examination', status: this.liveStatus('no_red_flags', 'documented'), src: 'Clinical note' },
      { id: 'C4', label: '\u2265 6 wks self-directed conservative care', status: c4, src: s.addendumApproved ? 'Approved addendum \u00b7 transcript' : 'Transcript (conversation-enriched)' },
      { id: 'C5', label: 'Completed course of physical therapy', status: c5, src: s.recordReceived ? 'External record \u00b7 Metro PT' : (s.patientAnswered ? 'Patient response' : 'Not yet established') },
    ];
  }

  readiness() {
    const cr = this.criteriaRaw();
    const sum = cr.reduce((a, c) => a + this.statusMeta(c.status).w, 0);
    return Math.round((sum / cr.length) * 100);
  }

  phase() {
    const s = this.state.steps;
    if (!s.addendumApproved) return 'addendum';
    if (!s.patientAnswered) return 'patient';
    if (!s.recordReceived) return 'record';
    if (!s.packetGenerated) return 'packet';
    if (!s.submitted) return 'submit';
    return 'track';
  }

  candidates() {
    const p = this.phase();
    const rp = this.readiness();
    const mk = (o) => o;
    const good = { c: 'oklch(0.45 0.1 155)', b: 'oklch(0.96 0.03 155)' };
    const warn = { c: 'oklch(0.5 0.08 60)', b: 'oklch(0.97 0.04 75)' };
    const bad = { c: 'oklch(0.5 0.11 25)', b: 'oklch(0.97 0.03 25)' };
    const sets = {
      addendum: [
        mk({ kind: 'draft \u00b7 in-house', title: 'Draft clinical-note addendum', desc: 'Capture patient-reported conservative care from the transcript, clinician-approved, into the record.', delta: 'C4 partial \u2192 documented', proj: 'Readiness ' + rp + '% \u2192 80%', tone: good, key: 'DRAFT_ADDENDUM', cta: 'Open addendum', exec: () => this.go('addendum') }),
        mk({ kind: 'ask \u00b7 patient', title: 'Ask patient about conservative care', desc: 'Patient cannot attest to clinical framing; yields unverified data before the note gap is closed.', delta: 'starts C5, C4 still partial', proj: 'Readiness \u2192 ~76% (unverified)', tone: warn, key: 'ASK_PATIENT', mods: { dP: 0.5, info: 0.5 }, cta: '', exec: () => {} }),
        mk({ kind: 'submit \u00b7 payer', title: 'Submit packet now', desc: 'Two criteria unresolved. Rollout projects a denial for insufficient conservative-therapy evidence.', delta: 'C4 partial, C5 unknown', proj: 'Denied \u2014 est. 82%', tone: bad, key: 'SUBMIT_NOW', cta: '', exec: () => {} }),
      ],
      patient: [
        mk({ kind: 'ask \u00b7 patient', title: 'Ask patient: PT history + location', desc: 'Smallest targeted question that can unlock C5. Secure single-tap link, no policy interpretation asked.', delta: 'unlocks C5 verification path', proj: 'Readiness \u2192 92% \u2192 100%', tone: good, key: 'ASK_PATIENT', cta: 'Send question', exec: () => { this.set({ patientAsked: true }); this.go('patient'); } }),
        mk({ kind: 'ask \u00b7 clinician', title: 'Ask clinician to confirm PT', desc: 'Clinician cannot attest to external PT they did not supervise. Low expected yield.', delta: 'no state change likely', proj: 'Readiness \u2192 ~80%', tone: warn, key: 'ASK_CLINICIAN', cta: '', exec: () => {} }),
        mk({ kind: 'submit \u00b7 payer', title: 'Submit with current evidence', desc: 'PT entirely unknown. Rollout projects a request for more information.', delta: 'C5 unknown', proj: 'More info \u2014 est. 74%', tone: warn, key: 'SUBMIT_NOW', mods: { dP: 0.6 }, cta: '', exec: () => {} }),
      ],
      record: [
        mk({ kind: 'request \u00b7 record', title: 'Request records from Metro PT', desc: 'Convert patient-reported PT into verified, provenance-linked documentation.', delta: 'C5 patient-reported \u2192 verified', proj: 'Readiness ' + rp + '% \u2192 100%', tone: good, key: 'REQUEST_RECORD', cta: 'Request record', exec: () => { this.set({ recordRequested: true }); this.go('record'); } }),
        mk({ kind: 'ask \u00b7 patient', title: 'Ask patient to upload PT summary', desc: 'Faster, but lower provenance and higher payer-scrutiny risk than a direct release.', delta: 'C5 \u2192 patient-uploaded', proj: 'Readiness \u2192 ~96%', tone: warn, key: 'ASK_PATIENT', mods: { dP: 0.6, info: 0.5, burden: 0.8 }, cta: '', exec: () => {} }),
        mk({ kind: 'submit \u00b7 payer', title: 'Submit with patient-reported PT', desc: 'Unverified PT often triggers a documentation request. Rollout projects more-info.', delta: 'C5 patient-reported', proj: 'More info \u2014 est. 63%', tone: warn, key: 'SUBMIT_NOW', mods: { dP: 0.4 }, cta: '', exec: () => {} }),
      ],
      packet: [
        mk({ kind: 'generate \u00b7 packet', title: 'Generate provenance-backed packet', desc: 'All five criteria supported. Assemble a review-ready draft with source links on every assertion.', delta: 'produces review-ready draft', proj: 'All 5 criteria supported', tone: good, key: 'GENERATE_PACKET', cta: 'Generate packet', exec: () => { this.set({ packetGenerated: true }); this.go('packet'); } }),
        mk({ kind: 'hold', title: 'Hold for further review', desc: 'No open criteria remain; delay adds no value and risks deadline pressure.', delta: 'no change', proj: 'Readiness holds 100%', tone: warn, key: 'HOLD', cta: '', exec: () => {} }),
        mk({ kind: 'ask \u00b7 clinician', title: 'Request extra clinical detail', desc: 'Marginal — criteria already met; additional detail unlikely to change the determination.', delta: 'no change', proj: 'Readiness holds 100%', tone: warn, key: 'ASK_CLINICIAN', mods: { dP: 0.3, info: 0.3 }, cta: '', exec: () => {} }),
      ],
      submit: [
        mk({ kind: 'submit \u00b7 payer', title: 'Submit packet to Meridian', desc: 'Fully supported, provenance-linked packet. Rollout projects a favorable determination.', delta: 'case \u2192 submitted', proj: 'Approval \u2014 est. 88%', tone: good, key: 'SUBMIT_READY', cta: 'Submit', exec: () => this.go('packet') }),
        mk({ kind: 'hold', title: 'Hold for clinician sign-off', desc: 'Reasonable, but the packet is already clinician-reviewed and deadline is active.', delta: 'no change', proj: 'no progress', tone: warn, key: 'HOLD', cta: '', exec: () => {} }),
        mk({ kind: 'peer-to-peer', title: 'Pre-schedule peer-to-peer', desc: 'Premature before a determination exists. Reserve for a denial branch.', delta: 'no change', proj: 'n/a', tone: warn, key: 'PEER_TO_PEER', mods: { dP: 0.1, info: 0.2 }, cta: '', exec: () => {} }),
      ],
      track: [
        mk({ kind: 'observe', title: 'Track payer determination', desc: 'Case submitted. Awaiting a payer observation to re-plan against.', delta: 'monitoring', proj: 'Awaiting response', tone: good, key: 'TRACK', cta: 'Go to tracking', exec: () => this.go('lifecycle') }),
      ],
    };
    const list = sets[p] || sets.track;
    list.forEach(c => { const r = this.computeEV(c.key || 'HOLD', c.mods || {}); c.score = r.ev; c.terms = r.terms; });
    let best = 0; list.forEach((c, i) => { if (c.score > list[best].score) best = i; });
    return list.map((c, i) => ({ ...c, recommended: i === best }));
  }

  stageStatus(id) {
    const s = this.state.steps;
    const pr = s.payerResponse;
    const rp = this.readiness();
    switch (id) {
      case 'encounter': return 'done';
      case 'world': return 'ok';       // lens · no input needed
      case 'decision': return 'ok';    // lens · no input needed
      case 'addendum':
        if (s.addendumApproved) return 'done';
        return 'you';                  // clinician must approve
      case 'patient':
        if (s.patientAnswered) return 'done';
        if (s.patientAsked) return 'patient';
        return s.addendumApproved ? 'you' : 'upcoming';
      case 'packet':
        if (s.packetGenerated) return 'done';
        return rp >= 100 ? 'you' : 'upcoming';
      case 'lifecycle':
        if (pr === 'approve') return 'done';
        if (pr === 'deny') return 'appeal';
        if (pr === 'more') return 'you';
        if (s.submitted) return 'payer';
        return s.packetGenerated ? 'you' : 'upcoming';
    }
    return 'upcoming';
  }

  statusViz(k) {
    const M = {
      done:    { bg: 'oklch(0.6 0.11 155)', border: 'oklch(0.6 0.11 155)', glyph: '\u2713', glyphColor: '#fff', dot: '', pulse: false, subColor: 'oklch(0.5 0.08 155)' },
      you:     { bg: 'oklch(0.45 0.12 255)', border: 'oklch(0.45 0.12 255)', glyph: '', glyphColor: '#fff', dot: '#fff', pulse: true, subColor: 'oklch(0.5 0.1 255)' },
      patient: { bg: '#fff', border: 'oklch(0.7 0.11 70)', glyph: '', glyphColor: '', dot: 'oklch(0.7 0.11 70)', pulse: true, subColor: 'oklch(0.55 0.09 65)' },
      payer:   { bg: '#fff', border: 'oklch(0.55 0.13 250)', glyph: '', glyphColor: '', dot: 'oklch(0.55 0.13 250)', pulse: true, subColor: 'oklch(0.5 0.1 255)' },
      appeal:  { bg: 'oklch(0.57 0.15 25)', border: 'oklch(0.57 0.15 25)', glyph: '!', glyphColor: '#fff', dot: '', pulse: true, subColor: 'oklch(0.55 0.12 25)' },
      ok:      { bg: 'oklch(0.95 0.04 155)', border: 'oklch(0.78 0.08 155)', glyph: '', glyphColor: '', dot: 'oklch(0.6 0.11 155)', pulse: false, subColor: 'oklch(0.62 0.015 258)' },
      upcoming:{ bg: 'oklch(0.965 0.006 258)', border: 'oklch(0.9 0.008 255)', glyph: '', glyphColor: 'oklch(0.62 0.02 258)', dot: '', pulse: false, subColor: 'oklch(0.66 0.015 258)' },
    };
    return M[k] || M.upcoming;
  }

  renderVals() {
    this.boot();
    const s = this.state.steps;
    const screen = this.state.screen;
    const rp = this.readiness();
    const engine = this.state.engine;
    const engineLabel = engine === 'live' ? 'ENGINE LIVE' : (engine === 'offline' ? 'DESIGN MODE' : 'CONNECTING…');
    const engineDot = engine === 'live' ? 'oklch(0.6 0.11 155)' : (engine === 'offline' ? 'oklch(0.7 0.11 70)' : 'oklch(0.75 0.02 258)');
    const readinessColor = rp >= 100 ? 'oklch(0.55 0.11 155)' : (rp >= 85 ? 'oklch(0.6 0.11 155)' : 'oklch(0.55 0.13 250)');
    const readinessLabel = rp >= 100 ? 'All criteria supported' : (rp >= 85 ? 'Nearly ready' : 'Evidence gaps open');

    const cr = this.criteriaRaw();
    const criteria = cr.map(c => {
      const m = this.statusMeta(c.status);
      return {
        id: c.id, label: c.label,
        chipBg: m.bg, chipColor: m.color, chipBorder: m.border,
        packetSource: c.src, packetTag: m.label,
      };
    });

    // nav
    const stages = [
      { id: 'encounter', label: 'Encounter', sub: 'recorded \u00b7 analyzed', doneKey: 'always', marker: '01' },
      { id: 'world', label: 'World model', sub: 'case state', doneKey: null, marker: '02' },
      { id: 'decision', label: 'Decision engine', sub: 'roll out \u00b7 decide', doneKey: null, marker: '03' },
      { id: 'addendum', label: 'Addendum', sub: 'clinician-approved', doneKey: 'addendumApproved', marker: '04' },
      { id: 'patient', label: 'Patient question', sub: 'targeted \u00b7 secure', doneKey: 'patientAnswered', marker: '05' },
      { id: 'packet', label: 'PA packet', sub: 'provenance-backed', doneKey: 'packetGenerated', marker: '06' },
      { id: 'lifecycle', label: 'Submission', sub: 'track \u00b7 appeal', doneKey: 'submitted', marker: '07' },
    ];
    const subYou = { addendum: 'review & approve', patient: 'send question', packet: 'review & submit', lifecycle: 'submit packet' };
    const navItems = stages.map(st => {
      const active = screen === st.id || (st.id === 'addendum' && screen === 'record');
      const status = this.stageStatus(st.id);
      const v = this.statusViz(status);
      let sub = st.sub;
      if (status === 'you') { sub = subYou[st.id] || 'needs your action'; if (st.id === 'lifecycle' && s.payerResponse === 'more') sub = 'answer info request'; }
      else if (status === 'patient') sub = 'waiting on patient';
      else if (status === 'payer') sub = 'waiting on payer';
      else if (status === 'appeal') sub = 'appeal needed';
      return {
        label: st.label, sub,
        onClick: () => this.go(st.id),
        glyph: status === 'upcoming' ? st.marker : v.glyph,
        markBg: v.bg, markBorder: active ? 'oklch(0.45 0.12 255)' : v.border, glyphColor: v.glyphColor,
        dotColor: v.dot, dotAnim: v.pulse ? 'animation:prx-pulse 1.6s infinite;' : '',
        bg: active ? 'oklch(0.96 0.02 250)' : 'transparent',
        border: active ? 'oklch(0.88 0.04 250)' : 'transparent',
        textColor: active ? 'oklch(0.35 0.06 255)' : (status === 'upcoming' ? 'oklch(0.6 0.02 258)' : 'oklch(0.4 0.02 258)'),
        weight: active ? 600 : 500,
        subColor: v.subColor,
      };
    });

    // exec log
    const log = [{ text: 'Encounter recorded, transcribed, analyzed against payer criteria', time: '09:14', color: 'oklch(0.55 0.13 250)' }];
    if (s.addendumApproved) log.push({ text: 'Addendum approved \u2192 C4 documented (clinician-reviewed)', time: '09:21', color: 'oklch(0.55 0.11 155)' });
    if (s.outreachApproved) log.push({ text: 'Outreach approved (human go-ahead) \u2192 question dispatched via ' + ({ sms: 'Twilio SMS', voice: 'Twilio voice + ElevenLabs', link: 'secure link' }[s.outreachChannel]), time: '10:41', color: 'oklch(0.55 0.13 250)' });
    if (s.patientAnswered) log.push({ text: 'Patient response received \u2192 C5 patient-reported', time: '11:03', color: 'oklch(0.65 0.09 70)' });
    if (s.recordReceived) log.push({ text: 'Metro PT record verified \u2192 C5 documented', time: '14:47', color: 'oklch(0.55 0.11 155)' });
    if (s.payerResponse === 'deny') log.push({ text: 'Payer denied \u2014 insufficient conservative-therapy evidence \u2192 appeal replan', time: '15:20', color: 'oklch(0.55 0.15 25)' });
    if (s.appealLetterApproved) log.push({ text: 'Appeal letter approved (clinician) \u2192 evidence-bound rebuttal ready', time: '15:32', color: 'oklch(0.55 0.11 155)' });
    if (s.appealSubmitted) log.push({ text: 'Appeal filed with letter + PT record + P2P requested', time: '15:41', color: 'oklch(0.55 0.13 250)' });
    if (s.packetGenerated) log.push({ text: 'Provenance-backed packet generated \u00b7 review-ready', time: '14:52', color: 'oklch(0.55 0.13 250)' });
    if (s.submitted) log.push({ text: 'Submitted to Meridian Health Plan', time: '15:08', color: 'oklch(0.45 0.12 255)' });
    const execLog = log.slice().reverse();

    // layers (world model)
    const cChip = (c) => { const m = this.statusMeta(c.status); return { k: c.id + ' \u00b7 ' + this.short(c.label), v: c.src, chip: m.label, chipBg: m.bg, chipColor: m.color, chipBorder: m.border }; };
    const recMap = {
      addendum: { t: 'Draft a clinician-approved note addendum', w: 'Highest-value action \u2014 recovers documented conservative care from the conversation.' },
      patient: { t: 'Ask the patient one targeted PT question', w: 'The only remaining gap (C5) can only be opened by the patient.' },
      record: { t: 'Request records from Metro Physical Therapy', w: 'Patient-reported PT must be verified before it satisfies the criterion.' },
      packet: { t: 'Generate the provenance-backed PA packet', w: 'All five criteria are now supported \u2014 assemble the review-ready draft.' },
      submit: { t: 'Submit the packet to Meridian Health Plan', w: 'Packet is clinician-reviewed and fully provenance-linked.' },
      track: { t: 'Track the payer determination', w: 'Case submitted \u2014 monitor for a response to re-plan against.' },
    };
    const rec = recMap[this.phase()];

    const layers = [
      { idx: 'L1', title: 'Clinical state', desc: 'What care is requested and why', sep: 'transparent',
        rows: [
          { k: 'requested_service', v: 'MRI lumbar spine w/o contrast (72148)', chip: '' },
          { k: 'primary_dx', v: 'Chronic mechanical low-back pain', chip: '' },
          { k: 'comorbid_flags', v: 'PHQ-9 17 (tracked) \u00b7 BP 136/94 (recheck)', chip: '' },
        ] },
      { idx: 'L2', title: 'Evidence state', desc: 'What is documented, derived, verified, or unknown', sep: 'oklch(0.93 0.006 258)',
        rows: cr.map(cChip) },
      { idx: 'L3', title: 'Coverage state', desc: 'Payer criteria and current support', sep: 'oklch(0.93 0.006 258)',
        rows: [
          { k: 'payer', v: 'Meridian Health Plan \u00b7 Commercial', chip: '' },
          { k: 'pathway', v: 'Advanced imaging \u2014 conservative-therapy pathway', chip: '' },
          { k: 'readiness', v: rp + '% of criteria supported', chip: rp >= 100 ? 'READY' : 'IN PROGRESS', chipBg: rp >= 100 ? 'oklch(0.96 0.03 155)' : 'oklch(0.96 0.02 250)', chipColor: rp >= 100 ? 'oklch(0.45 0.1 155)' : 'oklch(0.45 0.12 255)', chipBorder: rp >= 100 ? 'oklch(0.86 0.05 155)' : 'oklch(0.87 0.04 250)' },
        ] },
      { idx: 'L4', title: 'Operational state', desc: 'Where the case is and who must act', sep: 'oklch(0.93 0.006 258)',
        rows: [
          { k: 'stage', v: this.stageLabel(), chip: '' },
          { k: 'owner', v: this.ownerLabel(), chip: '' },
          { k: 'deadline', v: 'PA decision SLA \u00b7 5 business days', chip: '' },
        ] },
      { idx: 'L5', title: 'Action state', desc: 'Feasible actions and the recommendation', sep: 'oklch(0.93 0.006 258)',
        rows: [
          { k: 'recommended', v: rec.t, chip: 'NEXT', chipBg: 'oklch(0.96 0.02 250)', chipColor: 'oklch(0.45 0.12 255)', chipBorder: 'oklch(0.87 0.04 250)' },
        ] },
    ];

    // candidates
    const candsRaw = this.candidates();
    const candidates = candsRaw.map(c => ({
      key: c.key, kind: c.kind, title: c.title, desc: c.desc, delta: c.delta, proj: c.proj,
      recommended: c.recommended, cta: c.cta, onExecute: c.exec,
      projColor: c.tone.c, projBg: c.tone.b,
      scoreText: c.score.toFixed(2), scorePct: Math.max(3, Math.min(100, Math.round((c.score / 0.6) * 100))), evTerms: c.terms,
      scoreColor: c.recommended ? 'oklch(0.45 0.12 255)' : 'oklch(0.65 0.015 258)',
      cardBorder: c.recommended ? 'oklch(0.55 0.13 250)' : 'oklch(0.91 0.008 255)',
      cardShadow: c.recommended ? '0 8px 30px -12px oklch(0.55 0.13 250 / 0.4)' : 'none',
    }));

    // addendum status
    const addStatus = s.addendumApproved ? 'CLINICIAN-REVIEWED' : 'AWAITING APPROVAL';
    const addStatusColor = s.addendumApproved ? 'oklch(0.45 0.1 155)' : 'oklch(0.55 0.09 65)';
    const addStatusBg = s.addendumApproved ? 'oklch(0.96 0.03 155)' : 'oklch(0.97 0.04 75)';
    const addStatusBorder = s.addendumApproved ? 'oklch(0.86 0.05 155)' : 'oklch(0.88 0.05 75)';

    // record status
    const recStatusLabel = s.recordReceived ? 'RECEIVED' : (s.recordRequested ? 'REQUEST SENT' : 'PENDING');
    const recStatusColor = s.recordReceived ? 'oklch(0.45 0.1 155)' : 'oklch(0.55 0.09 65)';
    const recStatusBg = s.recordReceived ? 'oklch(0.96 0.03 155)' : 'oklch(0.97 0.04 75)';
    const recStatusBorder = s.recordReceived ? 'oklch(0.86 0.05 155)' : 'oklch(0.88 0.05 75)';

    // lifecycle
    const order = ['Ready', 'Submitted', 'Waiting on payer', 'Determination', this.state.steps.payerResponse === 'deny' ? 'Appeal prep' : 'Resolved'];
    const respMap = { approve: 4, more: 3, deny: 4 };
    let curIdx = s.submitted ? 2 : 0;
    if (s.payerResponse) curIdx = respMap[s.payerResponse];
    const lifecycle = order.map((label, i) => {
      const reached = i <= curIdx;
      const isCur = i === curIdx;
      return {
        label,
        dot: isCur ? 'oklch(0.45 0.12 255)' : (reached ? 'oklch(0.6 0.11 155)' : 'oklch(0.92 0.006 258)'),
        ring: isCur ? 'oklch(0.85 0.05 250)' : (reached ? 'oklch(0.86 0.05 155)' : 'oklch(0.92 0.006 258)'),
        textColor: reached ? 'oklch(0.35 0.02 258)' : 'oklch(0.68 0.015 258)',
        weight: isCur ? 600 : 500,
        connector: i < order.length - 1,
        lineColor: i < curIdx ? 'oklch(0.6 0.11 155)' : 'oklch(0.92 0.006 258)',
      };
    });

    // observation
    const pr = s.payerResponse;
    const obs = {
      approve: { icon: '\u2713', color: 'oklch(0.45 0.1 155)', bg: 'oklch(0.96 0.03 155)', border: 'oklch(0.86 0.05 155)', title: 'Approved', a: 'observation: authorization granted', b: 'state \u2192 resolved \u00b7 no further action', action: 'Notify care team; close the loop.' },
      more: { icon: '\u25d0', color: 'oklch(0.5 0.08 60)', bg: 'oklch(0.97 0.04 75)', border: 'oklch(0.88 0.05 75)', title: 'More information requested', a: 'observation: payer requests functional-limitation detail', b: 'gap linked to payer response', action: 'Ask patient one question on current activity limits.' },
      deny: { icon: '\u2715', color: 'oklch(0.5 0.11 25)', bg: 'oklch(0.97 0.03 25)', border: 'oklch(0.86 0.06 25)', title: 'Denied', a: 'observation: denied \u2014 insufficient conservative-therapy evidence', b: 'appeal deadline active \u00b7 14 days', action: 'Prepare appeal + schedule peer-to-peer with the PT record attached.' },
    };
    const o = pr ? obs[pr] : null;

    // ---- case progress toward the real goal: approval / care delivered ----
    const done = {
      analyzed: true,
      evidence: rp >= 100,
      packet: s.packetGenerated,
      submitted: s.submitted,
      approved: pr === 'approve',
    };
    // Denial is not a terminal state: appeal progress keeps moving the case
    // toward the only real goal (care approved). 100% only at approval.
    const appealBonus = pr === 'deny' ? (0.04 * (s.appealLetterApproved ? 1 : 0) + 0.02 * (s.p2pPrepped ? 1 : 0) + 0.06 * (s.appealSubmitted ? 1 : 0)) : 0;
    const casePct = pr === 'approve'
      ? 100  // authorization IS the goal — approved means the path is complete
      : Math.min(99, Math.round((0.15 + 0.35 * (rp / 100) + 0.15 * (s.packetGenerated ? 1 : 0) + 0.15 * (s.submitted ? 1 : 0) + appealBonus) * 100));
    let caseStatus, caseColor;
    if (pr === 'approve') { caseStatus = 'Authorized \u2014 patient can receive care'; caseColor = 'oklch(0.5 0.11 155)'; }
    else if (pr === 'deny' && s.appealSubmitted) { caseStatus = 'Appeal filed \u2014 awaiting re-determination'; caseColor = 'oklch(0.55 0.15 25)'; }
    else if (pr === 'deny') { caseStatus = 'Denied \u2014 appeal in progress'; caseColor = 'oklch(0.55 0.15 25)'; }
    else if (pr === 'more') { caseStatus = 'More information requested'; caseColor = 'oklch(0.58 0.1 65)'; }
    else if (s.submitted) { caseStatus = 'Submitted \u2014 awaiting determination'; caseColor = 'oklch(0.5 0.12 255)'; }
    else if (s.packetGenerated) { caseStatus = 'Packet ready to submit'; caseColor = 'oklch(0.5 0.12 255)'; }
    else if (rp >= 100) { caseStatus = 'Evidence complete'; caseColor = 'oklch(0.5 0.12 255)'; }
    else { caseStatus = 'Gathering evidence'; caseColor = 'oklch(0.5 0.12 255)'; }

    const mDefs = [
      { key: 'analyzed', label: 'Encounter analyzed' },
      { key: 'evidence', label: 'Evidence complete' },
      { key: 'packet', label: 'Packet ready' },
      { key: 'submitted', label: 'Submitted' },
      { key: 'approved', label: 'Care approved' },
    ];
    let curM = mDefs.findIndex(m => !done[m.key]);
    if (curM === -1) curM = mDefs.length - 1;
    const denied = pr === 'deny';
    const milestones = mDefs.map((m, i) => {
      const isDone = done[m.key];
      const isCur = i === curM;
      const isDen = denied && m.key === 'approved';
      return {
        label: m.label,
        mark: isDen ? '\u2715' : (isDone ? '\u2713' : (i + 1)),
        dot: isDen ? 'oklch(0.55 0.15 25)' : (isDone ? 'oklch(0.6 0.11 155)' : (isCur ? 'oklch(0.45 0.12 255)' : 'oklch(0.94 0.006 258)')),
        ring: isDen ? 'oklch(0.88 0.06 25)' : (isDone ? 'oklch(0.86 0.05 155)' : (isCur ? 'oklch(0.85 0.05 250)' : 'oklch(0.92 0.006 258)')),
        markColor: (isDone || isCur || isDen) ? '#fff' : 'oklch(0.6 0.02 258)',
        textColor: (isDone || isCur || isDen) ? 'oklch(0.34 0.02 258)' : 'oklch(0.68 0.015 258)',
        weight: (isCur || isDen) ? 600 : 500,
        connector: i < mDefs.length - 1,
        flex: i < mDefs.length - 1 ? 'flex:1;' : 'flex:0 0 auto;',
        lineColor: i < curM ? 'oklch(0.6 0.11 155)' : 'oklch(0.92 0.006 258)',
      };
    });

    return {
      // screen flags
      isEncounter: screen === 'encounter',
      isWorld: screen === 'world',
      isDecision: screen === 'decision',
      isAddendum: screen === 'addendum',
      isPatient: screen === 'patient',
      isRecord: screen === 'record',
      isPacket: screen === 'packet',
      isLifecycle: screen === 'lifecycle',

      readinessPct: rp, readinessColor, readinessLabel,
      casePct, caseStatus, caseColor, milestones,
      criteria, navItems, execLog, layers, candidates,
      phaseKey: this.phase(),
      candCount: candsRaw.length,
      openCount: cr.filter(c => this.statusMeta(c.status).w < 1).length,
      stateVersion: 'v' + (log.length),
      lastEvent: (execLog[0] && execLog[0].time) || '09:14',
      recTitle: rec.t, recWhy: rec.w,

      transcript: this.transcript(),
      liveNote: this.state.liveNote,
      liveGapCallout: this.state.liveGapCallout,
      provenance: ['transcript \u00b7 12:04', 'clinical note', 'FHIR \u00b7 medication'],

      addStatus, addStatusColor, addStatusBg, addStatusBorder,
      addendumPending: !s.addendumApproved, addendumDone: s.addendumApproved,
      addendumEditing: this.state.addendumEditing,
      addendumText: this.state.addendumText,
      addendumEdit: () => this.setState({ addendumEditing: true }),
      addendumCancelEdit: () => this.setState({ addendumEditing: false }),
      addendumSaveEdit: (text) => this.setState({ addendumText: text, addendumEditing: false }),

      patientAnswered: s.patientAnswered, patientPending: !s.patientAnswered,
      outreachPending: !s.outreachApproved && !s.patientAnswered,
      outreachApproved: s.outreachApproved,
      awaitingReply: s.outreachApproved && !s.patientAnswered,
      chanSms: s.outreachChannel === 'sms', chanVoice: s.outreachChannel === 'voice', chanLink: s.outreachChannel === 'link',
      chanLabel: { sms: 'SMS · Twilio', voice: 'Voice call · Twilio + ElevenLabs', link: 'Secure link' }[s.outreachChannel],
      pickSms: () => this.set({ outreachChannel: 'sms' }),
      pickVoice: () => this.set({ outreachChannel: 'voice' }),
      pickLink: () => this.set({ outreachChannel: 'link' }),
      approveOutreach: () => {
        this.set({ outreachApproved: true });
        // Fire the real outreach (server decides recipient/sender/mode; the
        // hosted deployment simulates, the demo Mac actually texts the phone).
        this.api('send_outreach', { channel: this.state.steps.outreachChannel })
          .then(r => { if (r.sent) this.set({ outreachSentVia: r.mode }); })
          .catch(() => {});
      },

      recStatusLabel, recStatusColor, recStatusBg, recStatusBorder,
      recordPending: !s.recordReceived, recordDone: s.recordReceived,

      lifecycle,
      hasResponse: !!pr, noResponse: !pr,
      obsIcon: o ? o.icon : '', obsColor: o ? o.color : '', obsBg: o ? o.bg : '', obsBorder: o ? o.border : 'oklch(0.91 0.008 255)',
      obsTitle: o ? o.title : '', obsDetailA: o ? o.a : '', obsDetailB: o ? o.b : '', obsAction: o ? o.action : '',

      engineLabel, engineDot,

      // handlers
      goEncounter: () => this.go('encounter'),
      goWorld: () => this.go('world'),
      goDecision: () => this.go('decision'),

      // dated-visit browser
      visits: (this.state.visits || []).map(v => ({
        id: v.id, date: v.date, title: v.visit_title,
        selected: v.id === this.state.selectedVisitId,
        analyzed: v.id === this.state.analyzedVisitId,
      })),
      visitNeedsAnalyze: !!this.state.selectedVisitId && this.state.selectedVisitId !== this.state.analyzedVisitId,
      selectVisit: (id) => this.selectVisit(id),
      analyzeCurrentVisit: () => this.analyzeVisit(this.state.selectedVisitId),
      approveAddendum: () => { this.set({ addendumApproved: true }); this.decide('conservative_care', 'approve'); },
      patientRespond: () => { this.set({ patientAnswered: true }); this.decide('functional_limitation', 'answer', '~8 weeks at Metro Physical Therapy, Jan–Mar.'); },
      receiveRecord: () => { this.set({ recordReceived: true }); },
      generateAndGo: () => { this.set({ packetGenerated: true }); this.go('packet'); },
      downloadPacketPdf: () => {
        const cr = this.criteriaRaw().map(c => ({
          id: c.id, label: c.label,
          packetSource: c.src,
          packetTag: this.statusMeta(c.status).label,
        }));
        buildPacketPdf({ criteria: cr, addendumApproved: s.addendumApproved, patientAnswered: s.patientAnswered, recordReceived: s.recordReceived });
      },
      submitPacket: () => { this.set({ submitted: true }); this.go('lifecycle'); },
      respApprove: () => this.set({ payerResponse: 'approve' }),
      respMore: () => this.set({ payerResponse: 'more' }),
      respDeny: () => this.set({ payerResponse: 'deny' }),
      respReset: () => this.set({ payerResponse: null, appealLetterApproved: false, p2pPrepped: false, appealSubmitted: false }),

      // ---- post-denial workspace: appeal letter + peer-to-peer prep ----
      isDenied: pr === 'deny',
      appealLetterApproved: s.appealLetterApproved,
      p2pPrepped: s.p2pPrepped,
      appealSubmitted: s.appealSubmitted,
      appealCandidates: (() => {
        if (pr !== 'deny') return [];
        const defs = [
          { key: 'APPEAL_LETTER', title: 'Draft appeal letter', desc: 'Bind the denial reason to the verified evidence: addendum, PT record, red-flag screen.', cta: true },
          { key: 'PEER_TO_PEER', title: 'Schedule peer-to-peer', desc: 'Dr. Reyes to payer medical director, prepped with the criteria-mapped call sheet.', cta: true },
          { key: 'RESUBMIT', title: 'Resubmit unchanged', desc: 'Same packet, same evidence. The determination rarely changes without new information.', cta: false },
        ];
        const scored = defs.map(d => { const r = this.computeEV(d.key); return { ...d, ev: r.ev, terms: r.terms }; });
        const best = Math.max(...scored.map(x => x.ev));
        return scored.map(x => ({ ...x, recommended: x.ev === best }));
      })(),
      approveAppealLetter: () => { this.set({ appealLetterApproved: true }); },
      denialReason: s.denialReason,
      denialRef: s.denialRef,
      setDenialReason: (v) => this.set({ denialReason: v }),
      setDenialRef: (v) => this.set({ denialRef: v }),
      downloadAppealPdf: () => {
        const cr = this.criteriaRaw().map(c => ({
          id: c.id, label: c.label, packetTag: this.statusMeta(c.status).label,
        }));
        buildAppealPdf({
          criteria: cr,
          denialReason: s.denialReason,
          denialRef: s.denialRef,
          addendumApproved: s.addendumApproved,
          patientAnswered: s.patientAnswered,
          recordReceived: s.recordReceived,
          payerRequirements: 'ACR Appropriateness Criteria — Low Back Pain, 2021, administered via eviCore; sourced from the plan’s published policy',
        });
      },
      prepP2P: () => { this.set({ p2pPrepped: true }); },
      submitAppeal: () => { this.set({ appealSubmitted: true }); },
      appealOverturned: () => { this.set({ payerResponse: 'approve' }); },
      appealPayerIntel: (() => {
        const rows = this.state.payerIntel?.payers || [];
        const uhc = rows.find(x => (x.payer || '').startsWith('UnitedHealthcare'));
        return uhc
          ? `criteria family: ${uhc.criteriaFamily} · RBM: ${uhc.rbmDelegate} · sourced via Praxigen coverage sync`
          : 'payer intel syncing…';
      })(),

      // ---- value-function display (equation strip on the decision screen) ----
      evWA: (this.state.priors?.value_function?.weights?.wApproval ?? 1).toFixed(2),
      evWI: (this.state.priors?.value_function?.weights?.wInfo ?? 0.35).toFixed(2),
      evWT: (this.state.priors?.value_function?.weights?.wTime ?? 0.25).toFixed(2),
      evWB: (this.state.priors?.value_function?.weights?.wBurden ?? 0.15).toFixed(2),
      evFitMeta: this.state.priors ? this.state.priors._meta.fitFrom : 'fitting…',
      evFlywheel: this.state.priors
        ? `${this.state.priors.flywheel.trajectoriesLogged} trajectories logged · refit ${this.state.priors.flywheel.lastRefit || 'pending'}`
        : '…',
    };
  }

  short(l) {
    return l.replace('Symptom duration \u2265 6 weeks', 'duration')
      .replace('Red-flag pathology absent', 'red_flags')
      .replace('Documented neurologic examination', 'neuro_exam')
      .replace('\u2265 6 wks self-directed conservative care', 'conservative_care')
      .replace('Completed course of physical therapy', 'physical_therapy');
  }
  stageLabel() {
    const p = this.phase();
    return { addendum: 'Evidence recovery \u00b7 addendum', patient: 'Information gathering \u00b7 patient', record: 'Verification \u00b7 external record', packet: 'Packet assembly', submit: 'Ready to submit', track: 'Submitted \u00b7 tracking' }[p];
  }
  ownerLabel() {
    const p = this.phase();
    return { addendum: 'Clinician \u2014 approve addendum', patient: 'Patient \u2014 answer question', record: 'Praxess \u2014 retrieve record', packet: 'Clinician \u2014 review packet', submit: 'Clinician \u2014 submit', track: 'Payer \u2014 determination' }[p];
  }
  transcript() {
    const live = this.state.liveTranscript;
    if (live) {
      // Parse "SPEAKER: text" lines from raw transcript string
      const lines = live.split('\n').filter(l => l.trim());
      const parsed = [];
      for (const line of lines) {
        const m = line.match(/^(DR|PT|Doctor|Patient|Provider|Clinician)[:\s]+(.+)/i);
        if (m) {
          const tag = m[1].toUpperCase().startsWith('D') ? 'DR' : 'PT';
          const text = m[2].trim();
          const flag = /ibuprofen|physical therapy|pt\b|conservative/i.test(text);
          parsed.push({ tag, text, flag });
        } else if (line.trim()) {
          parsed.push({ tag: '—', text: line.trim(), flag: false });
        }
      }
      if (parsed.length > 0) {
        return parsed.map(t => ({
          tag: t.tag,
          text: t.text,
          tagColor: t.tag === 'DR' ? 'oklch(0.45 0.12 255)' : 'oklch(0.55 0.09 300)',
          rowBg: t.flag ? 'oklch(0.97 0.02 250)' : 'transparent',
          rowBorder: t.flag ? 'oklch(0.9 0.02 250)' : 'transparent',
        }));
      }
    }
    // fallback hardcoded demo transcript
    return [
      { tag: "PT", text: "A dull band across the very bottom of my back. Right now it's like a four out of ten. Desk days make it worse." },
      { tag: "DR", text: "Does it ever shoot down a leg? Numbness, tingling, weakness in the feet?" },
      { tag: "PT", text: "No, nothing like that. It stays in the back." },
      { tag: "DR", text: "Boring is actually good news with backs. What helps?", flag: true },
      { tag: "PT", text: "Walking. Hot showers. I had ibuprofen for a while, which worked, but the bottle ran out months ago and I never dealt with it.", flag: true },
      { tag: "DR", text: "I'm prescribing ibuprofen 400 milligrams — take one with food when it flares, not on an empty stomach." },
    ].map(t => ({
      tag: t.tag,
      text: t.text,
      tagColor: t.tag === 'DR' ? 'oklch(0.45 0.12 255)' : 'oklch(0.55 0.09 300)',
      rowBg: t.flag ? 'oklch(0.97 0.02 250)' : 'transparent',
      rowBorder: t.flag ? 'oklch(0.9 0.02 250)' : 'transparent',
    }));
  }
}



export default function LoopApp({ onBackToWorkspace }) {
  const inst = useDC(Component);
  const [showRecord, setShowRecord] = useState(false)
  const [addendumDraft, setAddendumDraft] = useState('')
  const [analyzing, setAnalyzing] = useState(false)

  // Recording state (inline in encounter page) — one-button flow.
  // Web Speech transcribes in real time; Claude diarization streams in a beat
  // behind it, labeling DR/PT turns automatically (no manual speaker toggle).
  const [recRecording, setRecRecording] = useState(false)
  const [recRaw, setRecRaw] = useState('')           // all finalized speech, in order
  const [recLabeled, setRecLabeled] = useState([])   // diarized turns from Claude
  const [recLabeledUpTo, setRecLabeledUpTo] = useState(0) // chars of recRaw covered by recLabeled
  const [recInterim, setRecInterim] = useState('')
  const [recNote, setRecNote] = useState('')
  const [recSupported, setRecSupported] = useState(true)
  const [diarizing, setDiarizing] = useState(false)
  const recRef = useRef(null)
  const recActiveRef = useRef(false)                 // user intent (survives SR auto-timeouts)
  const recRawRef = useRef('')
  const diarizeRef = useRef({ busy: false, timer: null, seq: 0 })

  useEffect(() => { recRawRef.current = recRaw }, [recRaw])

  async function runDiarize() {
    const d = diarizeRef.current
    const raw = recRawRef.current
    if (d.busy || !raw.trim()) return
    d.busy = true
    const sent = raw.length
    const seq = ++d.seq
    setDiarizing(true)
    try {
      const data = await apiFetch('diarize', { transcript: raw })
      if (seq === d.seq && data.lines?.length) {
        setRecLabeled(data.lines)
        setRecLabeledUpTo(sent)
      }
    } catch (e) { console.warn('diarize', e) }
    finally {
      d.busy = false
      setDiarizing(false)
      // speech kept arriving while we labeled — go again for the tail
      if (recRawRef.current.length > sent) scheduleDiarize(600)
    }
  }

  function scheduleDiarize(ms = 1400) {
    const d = diarizeRef.current
    if (d.timer) clearTimeout(d.timer)
    d.timer = setTimeout(() => runDiarize(), ms)
  }

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setRecSupported(false); return }
    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.onresult = (e) => {
      let fin = '', int = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) fin += res[0].transcript + ' '
        else int += res[0].transcript
      }
      if (fin) { setRecRaw(prev => prev + fin); scheduleDiarize() }
      setRecInterim(int)
    }
    r.onerror = (e) => { if (e.error !== 'no-speech') console.warn('SR', e.error) }
    r.onend = () => {
      setRecInterim('')
      // Chrome times SR out after silence — restart while the user is still recording
      if (recActiveRef.current) { try { r.start() } catch { /* already restarting */ } }
      else setRecRecording(false)
    }
    recRef.current = r
    return () => { recActiveRef.current = false; r.abort() }
  }, [])

  function toggleRec() {
    const r = recRef.current
    if (!r) return
    if (recRecording) {
      recActiveRef.current = false
      r.stop(); setRecRecording(false)
      scheduleDiarize(200) // final labeling pass over the full take
    } else {
      recActiveRef.current = true
      r.start(); setRecRecording(true)
    }
  }

  function clearRec() {
    setRecRaw(''); setRecLabeled([]); setRecLabeledUpTo(0); setRecInterim('')
    diarizeRef.current.seq++ // invalidate any in-flight labeling
  }

  const recTail = recRaw.slice(recLabeledUpTo).trim()
  const recRawTranscript = [
    ...recLabeled.map(l => `${l.speaker}: ${l.text.trim()}`),
    ...(recTail ? [recTail] : []),
  ].join('\n')
  const recWords = recRaw.trim() ? recRaw.trim().split(/\s+/).length : 0

  const handleAnalyzeTranscript = useCallback(async (transcript, note) => {
    setAnalyzing(true)
    try {
      const data = await apiFetch('analyze_transcript', { transcript, note: note || '', session_id: 'design' })
      inst._applyState(data)
      inst.setState({
        screen: 'encounter',
        steps: {
          addendumApproved: false, patientAsked: false,
          outreachChannel: 'sms', outreachApproved: false,
          patientAnswered: false, recordRequested: false,
          recordReceived: false, packetGenerated: false,
          submitted: false, payerResponse: null,
          appealLetterApproved: false, p2pPrepped: false, appealSubmitted: false,
        },
      })
      setShowRecord(false)
    } catch (e) { console.error(e) }
    finally { setAnalyzing(false) }
  }, [inst])

  const V = inst.renderVals();
  const steps = inst.state.steps;
  // Source-node colors track the evidence state: verified sources green,
  // the patient channel amber once his report is in, payer policy brand blue.
  const constellationColors = {
    transcript: '#3f8f63',
    'clinical note': '#3f8f63',
    'FHIR chart': '#3f8f63',
    patient: steps.patientAnswered ? '#c08a3e' : '#9aa1ad',
    'payer policy': '#4059c8',
  };
  return (
    <>
<div className="prx-loop" style={css(`height:100vh;display:flex;flex-direction:column;background:oklch(0.985 0.005 245);font-family:'IBM Plex Sans',system-ui,sans-serif;color:oklch(0.30 0.03 258);overflow:hidden;`)}>

  
  <header style={css(`display:flex;align-items:center;gap:24px;padding:0 24px;height:60px;background:#fff;border-bottom:1px solid oklch(0.91 0.008 255);flex-shrink:0;z-index:5;`)}>
    <div style={css(`display:flex;align-items:center;gap:11px;`)}>
      <button type="button" className="prx-case-home" onClick={onBackToWorkspace} aria-label="Back to case workspace" title="Back to case workspace">
        <img src="/praxess_favicon.png" alt="" aria-hidden="true" />
        <span>Praxess</span>
      </button>
      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);border:1px solid oklch(0.9 0.008 255);border-radius:5px;padding:2px 6px;`)}>Closed-loop PA agent</span>
    </div>
    <div style={css(`width:1px;height:26px;background:oklch(0.91 0.008 255);`)}></div>
    <div style={css(`display:flex;flex-direction:column;gap:1px;`)}>
      <span style={css(`font-size:13px;font-weight:600;`)}>Kovacek, Emory · 22M</span>
      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.55 0.02 258);`)}>CASE PA-4471 · MRI lumbar spine w/o contrast (72148)</span>
    </div>
    <div style={css(`flex:1;`)}></div>
    <div style={css(`display:flex;align-items:center;gap:8px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.55 0.02 258);`)}>
      <span style={css(`width:7px;height:7px;border-radius:50%;background:${V.engineDot};animation:prx-pulse 2s infinite;`)}></span>
      {V.engineLabel}
    </div>
    <div style={css(`width:30px;height:30px;border-radius:50%;background:oklch(0.93 0.02 250);border:1px solid oklch(0.88 0.01 255);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:oklch(0.45 0.12 255);`)}>DR</div>
  </header>

  
  <div style={css(`display:flex;align-items:center;gap:32px;padding:13px 24px;background:#fff;border-bottom:1px solid oklch(0.91 0.008 255);flex-shrink:0;`)}>
    <div style={css(`display:flex;flex-direction:column;gap:2px;min-width:205px;`)}>
      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Path to approval</span>
      <div style={css(`display:flex;align-items:baseline;gap:9px;`)}>
        <span style={css(`font-size:23px;font-weight:700;letter-spacing:-0.01em;color:${V.caseColor};font-family:'IBM Plex Mono',monospace;`)}>{V.casePct}%</span>
        <span style={css(`font-size:12px;font-weight:500;color:${V.caseColor};`)}>{V.caseStatus}</span>
      </div>
      <span style={css(`font-size:11px;color:oklch(0.62 0.015 258);`)}>Goal &middot; authorization so Emory receives his MRI</span>
    </div>

    <div style={css(`flex:1;display:flex;align-items:flex-start;`)}>
      {V.milestones.map((m, _i0) => (<React.Fragment key={_i0}>
        <div style={css(`display:flex;align-items:flex-start;${m.flex}`)}>
          <div style={css(`display:flex;flex-direction:column;align-items:center;gap:6px;width:76px;flex-shrink:0;`)}>
            <span style={css(`width:20px;height:20px;border-radius:50%;background:${m.dot};border:2px solid ${m.ring};color:${m.markColor};display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;`)}>{m.mark}</span>
            <span style={css(`font-size:10.5px;text-align:center;line-height:1.25;color:${m.textColor};font-weight:${m.weight};`)}>{m.label}</span>
          </div>
          {(m.connector) ? (<>
            <span style={css(`flex:1;height:2px;background:${m.lineColor};margin-top:9px;border-radius:2px;transition:background .5s;`)}></span>
          </>) : null}
        </div>
      </React.Fragment>))}
    </div>

    <div style={css(`display:flex;flex-direction:column;gap:6px;min-width:158px;`)}>
      <div style={css(`display:flex;align-items:baseline;justify-content:space-between;`)}>
        <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Coverage readiness</span>
        <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:${V.readinessColor};`)}>{V.readinessPct}%</span>
      </div>
      <div style={css(`height:5px;border-radius:4px;background:oklch(0.94 0.006 258);overflow:hidden;`)}>
        <div style={css(`height:100%;border-radius:4px;background:${V.readinessColor};width:${V.readinessPct}%;transition:width .6s cubic-bezier(.4,0,.2,1);`)}></div>
      </div>
      <div style={css(`display:flex;gap:5px;margin-top:1px;`)}>
        {V.criteria.map((c, _i0) => (<React.Fragment key={_i0}>
          <span title={c.label} style={css(`width:20px;height:18px;border-radius:5px;background:${c.chipBg};color:${c.chipColor};display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;border:1px solid ${c.chipBorder};`)}>{c.id}</span>
        </React.Fragment>))}
      </div>
    </div>
  </div>

  <div style={css(`flex:1;display:flex;min-height:0;`)}>

    
    <nav style={css(`width:240px;flex-shrink:0;background:#fff;border-right:1px solid oklch(0.91 0.008 255);padding:16px 12px;display:flex;flex-direction:column;gap:2px;overflow:auto;`)}>
      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.68 0.015 258);padding:6px 10px 8px;`)}>The loop</span>
      {V.navItems.map((n, _i0) => (<React.Fragment key={_i0}>
        <button onClick={n.onClick} style={css(`display:flex;align-items:center;gap:11px;text-align:left;padding:9px 10px;border-radius:8px;border:1px solid ${n.border};background:${n.bg};cursor:pointer;font-family:'IBM Plex Sans',sans-serif;transition:background .15s;`)}>
          <span style={css(`width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;background:${n.markBg};color:${n.glyphColor};border:1.5px solid ${n.markBorder};`)}>
            {n.glyph}
            {(n.dotColor) ? (<>
              <span style={css(`width:8px;height:8px;border-radius:50%;background:${n.dotColor};${n.dotAnim}`)}></span>
            </>) : null}
          </span>
          <span style={css(`display:flex;flex-direction:column;gap:1px;min-width:0;`)}>
            <span style={css(`font-size:13px;font-weight:${n.weight};color:${n.textColor};`)}>{n.label}</span>
            <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:${n.subColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`)}>{n.sub}</span>
          </span>
        </button>
      </React.Fragment>))}
      <div style={css(`border-top:1px solid oklch(0.93 0.006 258);margin-top:10px;padding:12px 10px 2px;display:flex;flex-direction:column;gap:7px;`)}>
        <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.68 0.015 258);`)}>Status key</span>
        <div style={css(`display:flex;align-items:center;gap:8px;`)}><span style={css(`width:12px;height:12px;border-radius:50%;background:oklch(0.45 0.12 255);flex-shrink:0;`)}></span><span style={css(`font-size:11px;color:oklch(0.45 0.02 258);`)}>Your action needed</span></div>
        <div style={css(`display:flex;align-items:center;gap:8px;`)}><span style={css(`width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid oklch(0.7 0.11 70);flex-shrink:0;`)}></span><span style={css(`font-size:11px;color:oklch(0.45 0.02 258);`)}>Awaiting patient / payer</span></div>
        <div style={css(`display:flex;align-items:center;gap:8px;`)}><span style={css(`width:12px;height:12px;border-radius:50%;background:oklch(0.95 0.04 155);border:2px solid oklch(0.78 0.08 155);flex-shrink:0;`)}></span><span style={css(`font-size:11px;color:oklch(0.45 0.02 258);`)}>No input needed</span></div>
        <div style={css(`display:flex;align-items:center;gap:8px;`)}><span style={css(`width:12px;height:12px;border-radius:50%;background:oklch(0.6 0.11 155);color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;flex-shrink:0;`)}>\u2713</span><span style={css(`font-size:11px;color:oklch(0.45 0.02 258);`)}>Complete / past</span></div>
      </div>
      <div style={css(`flex:1;`)}></div>
      <div style={css(`border-top:1px solid oklch(0.93 0.006 258);margin-top:8px;padding:12px 10px 4px;`)}>
        <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.68 0.015 258);`)}>Execution log</span>
        <div style={css(`display:flex;flex-direction:column;gap:6px;margin-top:9px;`)}>
          {V.execLog.map((e, _i0) => (<React.Fragment key={_i0}>
            <div style={css(`display:flex;gap:8px;align-items:flex-start;`)}>
              <span style={css(`width:6px;height:6px;border-radius:50%;background:${e.color};margin-top:5px;flex-shrink:0;`)}></span>
              <div style={css(`display:flex;flex-direction:column;`)}>
                <span style={css(`font-size:11px;line-height:1.3;color:oklch(0.4 0.02 258);`)}>{e.text}</span>
                <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:9px;color:oklch(0.7 0.015 258);`)}>{e.time}</span>
              </div>
            </div>
          </React.Fragment>))}
        </div>
      </div>
    </nav>

    
    <main style={css(`flex:1;overflow:auto;`)}>
    <div className={V.isDecision ? 'prx-decision-main' : undefined} style={css(`max-width:1080px;margin:0 auto;padding:${V.isDecision ? '8px 32px 18px' : '28px 32px 56px'};`)}>

      
      {(V.isEncounter) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
        <div style={css(`display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;`)}>
          <div>
            <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>01 · Encounter capture</div>
            <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>{showRecord ? 'Record new encounter' : 'Live encounter, analyzed'}</h1>
          </div>
          {!showRecord && (
            <div style={css(`display:flex;align-items:center;gap:8px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.6 0.11 155);border:1px solid oklch(0.85 0.05 155);background:oklch(0.97 0.02 155);border-radius:7px;padding:7px 11px;`)}>
              <span style={css(`width:7px;height:7px;border-radius:50%;background:oklch(0.6 0.11 155);`)}></span>
              Recorded &amp; transcribed · speakers separated
            </div>
          )}
        </div>

        <div style={css(`display:grid;grid-template-columns:1.15fr 1fr;gap:18px;align-items:start;`)}>

          {/* Left panel — transcript view OR recorder */}
          <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;overflow:hidden;`)}>
            {/* Panel header with tabs */}
            <div style={css(`padding:10px 14px;border-bottom:1px solid oklch(0.93 0.006 258);display:flex;align-items:center;justify-content:space-between;`)}>
              <div style={css(`display:flex;gap:2px;background:oklch(0.95 0.006 258);border-radius:8px;padding:3px;`)}>
                <button
                  onClick={() => setShowRecord(false)}
                  style={css(`padding:5px 13px;border-radius:6px;border:none;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.04em;transition:all .15s;background:${!showRecord ? '#fff' : 'transparent'};color:${!showRecord ? 'oklch(0.34 0.02 258)' : 'oklch(0.6 0.02 258)'};box-shadow:${!showRecord ? '0 1px 3px oklch(0.3 0.02 258 / 0.1)' : 'none'};`)}>
                  Transcript
                </button>
                <button
                  onClick={() => setShowRecord(true)}
                  style={css(`padding:5px 13px;border-radius:6px;border:none;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.04em;transition:all .15s;background:${showRecord ? '#fff' : 'transparent'};color:${showRecord ? 'oklch(0.45 0.12 255)' : 'oklch(0.6 0.02 258)'};box-shadow:${showRecord ? '0 1px 3px oklch(0.3 0.02 258 / 0.1)' : 'none'};`)}>
                  🎙 Record
                </button>
              </div>
              {!showRecord && (V.visitNeedsAnalyze
                ? <button onClick={V.analyzeCurrentVisit} style={css(`padding:5px 11px;border-radius:7px;border:1px solid oklch(0.87 0.04 250);background:oklch(0.97 0.02 250);font-family:'IBM Plex Sans',sans-serif;font-size:11px;font-weight:600;color:oklch(0.45 0.12 255);cursor:pointer;`)}>Analyze this visit →</button>
                : <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.62 0.015 258);`)}>SRC · ambient recording</span>)}
              {showRecord && diarizing && (
                <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.45 0.12 255);display:flex;align-items:center;gap:5px;`)}>✦ labeling speakers…</span>
              )}
              {showRecord && !diarizing && recWords > 0 && !recRecording && (
                <button onClick={clearRec} style={css(`padding:4px 10px;border-radius:7px;border:1px solid oklch(0.91 0.008 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:11px;color:oklch(0.55 0.02 258);cursor:pointer;`)}>Clear</button>
              )}
            </div>

            {/* Dated visits — view any encounter's transcript */}
            {!showRecord && V.visits.length > 0 && (
              <div style={css(`display:flex;gap:6px;overflow-x:auto;padding:10px 14px 6px;border-bottom:1px solid oklch(0.95 0.006 258);`)}>
                {V.visits.map(v => (
                  <button key={v.id} onClick={() => V.selectVisit(v.id)} title={v.title}
                    style={css(`flex-shrink:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:7px 11px;border-radius:8px;cursor:pointer;transition:all .12s;border:1px solid ${v.selected ? 'oklch(0.55 0.13 250)' : 'oklch(0.91 0.008 255)'};background:${v.selected ? 'oklch(0.97 0.02 250)' : '#fff'};`)}>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:${v.selected ? 'oklch(0.45 0.12 255)' : 'oklch(0.55 0.02 258)'};`)}>{v.date}{v.analyzed ? ' · analyzed' : ''}</span>
                    <span style={css(`font-size:11px;color:oklch(0.45 0.02 258);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>{v.title}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Transcript view */}
            {!showRecord && (
              <div style={css(`padding:8px 16px 16px;display:flex;flex-direction:column;gap:3px;max-height:440px;overflow:auto;`)}>
                {V.transcript.map((t, _i0) => (<React.Fragment key={_i0}>
                  <div style={css(`display:flex;gap:11px;padding:9px 10px;border-radius:9px;background:${t.rowBg};border:1px solid ${t.rowBorder};`)}>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.06em;color:${t.tagColor};flex-shrink:0;width:34px;padding-top:1px;`)}>{t.tag}</span>
                    <span style={css(`font-size:13px;line-height:1.5;color:oklch(0.34 0.02 258);`)}>{t.text}</span>
                  </div>
                </React.Fragment>))}
              </div>
            )}

            {/* Record view */}
            {showRecord && (
              <div style={css(`padding:12px 14px;display:flex;flex-direction:column;gap:12px;`)}>
                {/* Controls — one red button; speakers are labeled automatically */}
                <div style={css(`display:flex;align-items:center;gap:14px;`)}>
                  <button
                    onClick={toggleRec}
                    aria-label={recRecording ? 'Stop recording' : 'Start recording'}
                    style={css(`width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:oklch(0.55 0.19 25);color:#fff;transition:box-shadow .2s;box-shadow:${recRecording ? '0 0 0 8px oklch(0.55 0.19 25 / 0.18)' : '0 2px 8px oklch(0.55 0.19 25 / 0.35)'};${recRecording ? 'animation:prx-pulse 1.6s infinite;' : ''}`)}>
                    {recRecording
                      ? <span style={css(`width:18px;height:18px;border-radius:4px;background:#fff;`)}></span>
                      : <span style={css(`width:20px;height:20px;border-radius:50%;background:#fff;`)}></span>}
                  </button>
                  <div style={css(`display:flex;flex-direction:column;gap:3px;`)}>
                    <span style={css(`font-size:13px;font-weight:600;color:oklch(0.34 0.02 258);`)}>
                      {recRecording ? 'Recording — transcribing live' : (recWords > 0 ? 'Recording stopped' : 'Tap to record the visit')}
                    </span>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.62 0.015 258);`)}>
                      doctor / patient separated automatically · live transcription
                    </span>
                  </div>
                  {recRecording && <span style={css(`margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.55 0.19 25);display:flex;align-items:center;gap:5px;`)}><span style={css(`width:6px;height:6px;border-radius:50%;background:oklch(0.55 0.19 25);animation:prx-pulse 1s infinite;`)}></span>LIVE</span>}
                  {recWords > 0 && !recRecording && <span style={css(`margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.65 0.015 258);`)}>{recWords}w</span>}
                </div>

                {/* Live transcript — labeled turns stream in behind the live text */}
                <div style={css(`min-height:180px;max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:2px;`)}>
                  {recWords === 0 && !recInterim && (
                    <span style={css(`font-size:12px;color:oklch(0.7 0.015 258);padding:6px 2px;`)}>Tap the red button and just talk — turns are transcribed live and labeled Doctor/Patient automatically.</span>
                  )}
                  {recLabeled.map((l, i) => (
                    <div key={i} style={css(`display:flex;gap:10px;padding:6px 8px;border-radius:7px;background:${l.speaker==='PT'?'oklch(0.985 0.005 300 / 0.5)':'transparent'};`)}>
                      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:${l.speaker==='DR'?'oklch(0.45 0.12 255)':'oklch(0.5 0.09 300)'};flex-shrink:0;width:28px;padding-top:2px;`)}>{l.speaker}</span>
                      <span style={css(`font-size:12px;line-height:1.5;color:oklch(0.34 0.02 258);`)}>{l.text.trim()}</span>
                    </div>
                  ))}
                  {recTail && (
                    <div style={css(`display:flex;gap:10px;padding:6px 8px;`)}>
                      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:oklch(0.7 0.015 258);flex-shrink:0;width:28px;padding-top:2px;`)}>…</span>
                      <span style={css(`font-size:12px;line-height:1.5;color:oklch(0.5 0.02 258);`)}>{recTail}</span>
                    </div>
                  )}
                  {recInterim && (
                    <div style={css(`display:flex;gap:10px;padding:6px 8px;opacity:0.5;`)}>
                      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:oklch(0.7 0.015 258);flex-shrink:0;width:28px;padding-top:2px;`)}>●</span>
                      <span style={css(`font-size:12px;line-height:1.5;color:oklch(0.34 0.02 258);font-style:italic;`)}>{recInterim}</span>
                    </div>
                  )}
                </div>

                {/* Paste fallback (no Web Speech in this browser) — still auto-labeled */}
                {!recSupported && (
                  <textarea
                    placeholder="Paste the conversation here — speakers are labeled automatically."
                    onChange={e => { setRecRaw(e.target.value); setRecLabeled([]); setRecLabeledUpTo(0); scheduleDiarize(800) }}
                    style={css(`width:100%;min-height:80px;border:1px solid oklch(0.91 0.008 255);border-radius:8px;padding:10px 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.6;color:oklch(0.34 0.02 258);outline:none;resize:vertical;box-sizing:border-box;`)}
                  />
                )}

                {/* Note field */}
                <textarea
                  value={recNote}
                  onChange={e => setRecNote(e.target.value)}
                  placeholder="Clinical note (optional)"
                  style={css(`width:100%;min-height:56px;border:1px solid oklch(0.91 0.008 255);border-radius:8px;padding:9px 12px;font-family:'IBM Plex Sans',sans-serif;font-size:12px;line-height:1.5;color:oklch(0.34 0.02 258);outline:none;resize:vertical;box-sizing:border-box;`)}
                />

                {/* Analyze */}
                <button
                  disabled={analyzing || recRawTranscript.length < 20}
                  onClick={() => handleAnalyzeTranscript(recRawTranscript, recNote)}
                  style={css(`padding:10px;border-radius:9px;border:none;background:${recRawTranscript.length>=20&&!analyzing?'oklch(0.45 0.12 255)':'oklch(0.88 0.006 258)'};color:${recRawTranscript.length>=20&&!analyzing?'#fff':'oklch(0.6 0.02 258)'};font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:${recRawTranscript.length>=20&&!analyzing?'pointer':'not-allowed'};`)}>
                  {analyzing ? 'Analyzing…' : 'Analyze →'}
                </button>
              </div>
            )}
          </div>

          {/* Right column — note + gap (unchanged) */}
          <div style={css(`display:flex;flex-direction:column;gap:16px;`)}>
            <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;overflow:hidden;`)}>
              <div style={css(`padding:13px 16px;border-bottom:1px solid oklch(0.93 0.006 258);display:flex;align-items:center;justify-content:space-between;`)}>
                <span style={css(`font-size:13px;font-weight:600;`)}>Clinical note · payer-visible</span>
                <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.62 0.015 258);`)}>FHIR</span>
              </div>
              <div style={css(`padding:14px 16px;font-size:13px;line-height:1.55;color:oklch(0.38 0.02 258);max-height:200px;overflow:auto;`)}>
                {V.liveNote
                  ? V.liveNote.slice(0, 800)
                  : <><span style={css(`font-weight:600;color:oklch(0.3 0.03 258);`)}>Chronic low back pain.</span> Mechanical, muscular pattern without red flags, aggravated by prolonged sitting; exam without neurologic deficit. Ibuprofen 400 mg oral tablet prescribed; take with food as needed for flares. Activity counseling: hourly breaks from sitting, daily walking, hip-hinge lifting mechanics. Reassess at 4-week follow-up.</>
                }
              </div>
            </div>

            <div style={css(`background:oklch(0.98 0.02 250);border:1px solid oklch(0.85 0.05 250);border-radius:12px;padding:16px;`)}>
              <div style={css(`display:flex;align-items:center;gap:8px;margin-bottom:10px;`)}>
                <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.45 0.12 255);`)}>Gap detected</span>
              </div>
              {V.liveGapCallout
                ? <p style={css(`margin:0 0 12px;font-size:13px;line-height:1.55;color:oklch(0.34 0.03 258);`)}><strong style={css(`font-weight:600;`)}>{V.liveGapCallout.title}:</strong> {V.liveGapCallout.detail}</p>
                : <p style={css(`margin:0 0 12px;font-size:13px;line-height:1.55;color:oklch(0.34 0.03 258);`)}>The note records prior ibuprofen use with good effect — but not how long the trial ran or why it stopped. The conversation has it: <strong style={css(`font-weight:600;`)}>&ldquo;ibuprofen for a while, which worked, but the bottle ran out months ago.&rdquo;</strong></p>
              }
              <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.5 0.05 258);background:#fff;border:1px solid oklch(0.9 0.02 250);border-radius:8px;padding:9px 11px;line-height:1.6;`)}>
                iron_rule: <span style={css(`color:oklch(0.45 0.12 255);font-weight:600;`)}>unknown&nbsp;≠&nbsp;no</span><br/>
                action: transcript may inform the record, <span style={css(`color:oklch(0.45 0.12 255);`)}>but cannot modify it</span>
              </div>
              <button onClick={V.goDecision} style={css(`margin-top:14px;width:100%;padding:11px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Roll out next best action →</button>
            </div>
          </div>
        </div>
      </div>
      </>) : null}


      {(V.isWorld) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
        <div style={css(`display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:22px;`)}>
          <div>
            <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>02 · World model</div>
            <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>Case state</h1>
            <p style={css(`margin:6px 0 0;font-size:13px;color:oklch(0.55 0.02 258);max-width:560px;`)}>Five layers of state, continuously refined from every observation. Each fact is bound to its source.</p>
          </div>
          <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.015 258);text-align:right;line-height:1.7;`)}>
            <div>state_version&nbsp;·&nbsp;{V.stateVersion}</div>
            <div>last_event&nbsp;·&nbsp;{V.lastEvent}</div>
          </div>
        </div>

        <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:14px;overflow:hidden;margin-bottom:18px;position:relative;`)}>
          <CaseConstellation height={280} statusColors={constellationColors} />
          <div style={css(`position:absolute;left:16px;bottom:12px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.015 258);line-height:1.6;`)}>
            every fact is a node bound to its source<br/>drag to spin · the state persists across observations
          </div>
        </div>

        <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:14px;overflow:hidden;`)}>
          {V.layers.map((L, _i0) => (<React.Fragment key={_i0}>
            <div style={css(`display:grid;grid-template-columns:190px 1fr;border-top:1px solid ${L.sep};`)}>
              <div style={css(`padding:20px 20px;background:oklch(0.985 0.004 255);border-right:1px solid oklch(0.93 0.006 258);display:flex;flex-direction:column;gap:5px;`)}>
                <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.14em;color:oklch(0.55 0.13 250);`)}>{L.idx}</span>
                <span style={css(`font-size:14px;font-weight:600;`)}>{L.title}</span>
                <span style={css(`font-size:11px;color:oklch(0.6 0.02 258);line-height:1.4;`)}>{L.desc}</span>
              </div>
              <div style={css(`padding:16px 20px;display:flex;flex-direction:column;gap:9px;`)}>
                {L.rows.map((r, _i1) => (<React.Fragment key={_i1}>
                  <div style={css(`display:flex;align-items:center;gap:12px;`)}>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.62 0.015 258);width:210px;flex-shrink:0;`)}>{r.k}</span>
                    <span style={css(`font-size:13px;color:oklch(0.34 0.02 258);flex:1;line-height:1.4;`)}>{r.v}</span>
                    {(r.chip) ? (<>
                      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.04em;padding:3px 9px;border-radius:20px;background:${r.chipBg};color:${r.chipColor};border:1px solid ${r.chipBorder};white-space:nowrap;flex-shrink:0;`)}>{r.chip}</span>
                    </>) : null}
                  </div>
                </React.Fragment>))}
              </div>
            </div>
          </React.Fragment>))}
        </div>

        <div style={css(`margin-top:18px;background:linear-gradient(135deg, oklch(0.45 0.12 255), oklch(0.5 0.1 235));border-radius:14px;padding:20px 22px;display:flex;align-items:center;gap:20px;color:#fff;position:relative;overflow:hidden;`)}>
          <div style={css(`position:relative;flex:1;`)}>
            <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.8;margin-bottom:6px;`)}>Recommended next action</div>
            <div style={css(`font-size:18px;font-weight:600;letter-spacing:-0.01em;`)}>{V.recTitle}</div>
            <div style={css(`font-size:13px;opacity:0.85;margin-top:4px;`)}>{V.recWhy}</div>
          </div>
          <button onClick={V.goDecision} style={css(`position:relative;padding:12px 20px;border-radius:10px;border:none;background:#fff;color:oklch(0.42 0.12 255);font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;`)}>See the rollout →</button>
        </div>
      </div>
      </>) : null}

      
      {(V.isDecision) ? (<>
      <DecisionRollout
        candidates={V.candidates}
        criteria={V.criteria}
        readinessPct={V.readinessPct}
        readinessColor={V.readinessColor}
        openCount={V.openCount}
        stateVersion={V.stateVersion}
        lastEvent={V.lastEvent}
        phase={V.phaseKey}
        fitMeta={V.evFitMeta}
        flywheel={V.evFlywheel}
        weights={{ approval: V.evWA, info: V.evWI, time: V.evWT, burden: V.evWB }}
      />
      </>) : null}


      {(V.isAddendum) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;max-width:760px;`)}>
        <div style={css(`margin-bottom:20px;`)}>
          <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>04 · Clinician-approved addendum</div>
          <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>Draft note addendum</h1>
        </div>

        <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;overflow:hidden;`)}>
          <div style={css(`padding:12px 18px;border-bottom:1px solid oklch(0.93 0.006 258);display:flex;align-items:center;justify-content:space-between;`)}>
            <span style={css(`font-size:13px;font-weight:600;`)}>Proposed addendum</span>
            <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:${V.addStatusColor};background:${V.addStatusBg};border:1px solid ${V.addStatusBorder};border-radius:20px;padding:3px 10px;`)}>{V.addStatus}</span>
          </div>
          <div style={css(`padding:20px 18px;`)}>
            {(V.addendumEditing) ? (
              <textarea
                autoFocus
                value={addendumDraft}
                onChange={e => setAddendumDraft(e.target.value)}
                style={css(`width:100%;min-height:110px;font-size:15px;line-height:1.7;color:oklch(0.3 0.02 258);border:1.5px solid oklch(0.55 0.13 250);border-radius:8px;padding:12px 14px;font-family:'IBM Plex Sans',system-ui,sans-serif;resize:vertical;outline:none;box-sizing:border-box;background:oklch(0.985 0.01 250);`)}
              />
            ) : (
              <p style={css(`margin:0;font-size:15px;line-height:1.7;color:oklch(0.3 0.02 258);border-left:3px solid oklch(0.55 0.13 250);padding-left:16px;`)}>{V.addendumText}</p>
            )}

            <div style={css(`margin-top:18px;display:flex;flex-direction:column;gap:8px;`)}>
              <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Provenance</span>
              <div style={css(`display:flex;flex-wrap:wrap;gap:8px;`)}>
                {V.provenance.map((p, _i0) => (<React.Fragment key={_i0}>
                  <span style={css(`display:inline-flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.45 0.05 255);background:oklch(0.97 0.01 250);border:1px solid oklch(0.9 0.015 250);border-radius:7px;padding:5px 10px;`)}><span style={css(`width:6px;height:6px;border-radius:2px;background:oklch(0.55 0.13 250);`)}></span>{p}</span>
                </React.Fragment>))}
              </div>
            </div>

            <div style={css(`margin-top:18px;background:oklch(0.98 0.02 75);border:1px solid oklch(0.88 0.05 75);border-radius:9px;padding:12px 14px;font-size:12px;line-height:1.55;color:oklch(0.42 0.04 60);`)}>
              <strong style={css(`font-weight:600;`)}>Safety guard:</strong> patient-reported context is preserved as patient-reported. It is not converted into a clinician-observed finding, and unresolved items (treatment duration) are flagged, not assumed.
            </div>
          </div>

          <div style={css(`padding:14px 18px;border-top:1px solid oklch(0.93 0.006 258);display:flex;gap:10px;background:oklch(0.985 0.004 255);`)}>
            {(V.addendumEditing) ? (<>
              <button
                onClick={() => { V.addendumSaveEdit(addendumDraft); }}
                style={css(`flex:1;padding:11px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>
                Save changes
              </button>
              <button
                onClick={() => { V.addendumCancelEdit(); setAddendumDraft(''); }}
                style={css(`padding:11px 18px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:oklch(0.4 0.02 258);cursor:pointer;`)}>
                Cancel
              </button>
            </>) : null}
            {(V.addendumPending && !V.addendumEditing) ? (<>
              <button onClick={V.approveAddendum} style={css(`flex:1;padding:11px;border-radius:9px;border:none;background:oklch(0.55 0.11 155);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>✓ Approve &amp; add to record</button>
              <button onClick={() => { setAddendumDraft(V.addendumText); V.addendumEdit(); }} style={css(`padding:11px 18px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:oklch(0.4 0.02 258);cursor:pointer;`)}>Edit</button>
              <button style={css(`padding:11px 18px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:oklch(0.55 0.02 258);cursor:pointer;`)}>Dismiss</button>
            </>) : null}
            {(V.addendumDone && !V.addendumEditing) ? (<>
              <div style={css(`flex:1;display:flex;align-items:center;gap:10px;font-size:13px;color:oklch(0.5 0.09 155);font-weight:500;`)}><span style={css(`width:20px;height:20px;border-radius:50%;background:oklch(0.55 0.11 155);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;`)}>✓</span>Clinician-reviewed · now payer-visible in the packet</div>
              <button onClick={V.goDecision} style={css(`padding:11px 18px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Next action →</button>
            </>) : null}
          </div>
        </div>
      </div>
      </>) : null}

      
      {(V.isPatient) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
        <div style={css(`margin-bottom:20px;`)}>
          <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>05 · Targeted patient question</div>
          <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>Smallest action likely to change the case</h1>
        </div>

        <div style={css(`display:grid;grid-template-columns:1fr 340px;gap:22px;align-items:start;`)}>
          <div style={css(`display:flex;flex-direction:column;gap:16px;`)}>
            <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;padding:18px;`)}>
              <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Generated question · targets C5</span>
              <p style={css(`margin:10px 0 0;font-size:16px;line-height:1.5;font-weight:500;color:oklch(0.3 0.02 258);`)}>"Have you done any physical therapy for your back — and if so, roughly where and for how long?"</p>
              <div style={css(`margin-top:14px;display:flex;align-items:center;gap:8px;font-size:12px;color:oklch(0.55 0.02 258);`)}>
                <span>No policy interpretation asked of the patient. One question, one answer.</span>
              </div>
            </div>

            {(!V.patientAnswered) ? (<>
              <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;padding:18px;`)}>
                <div style={css(`display:flex;align-items:center;justify-content:space-between;`)}>
                  <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Automated outreach · human in the loop</span>
                  <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:9px;color:oklch(0.62 0.015 258);border:1px solid oklch(0.9 0.008 255);border-radius:5px;padding:2px 6px;`)}>demo · simulated gateway</span>
                </div>
                <div style={css(`margin-top:12px;display:flex;gap:8px;`)}>
                  <button onClick={V.pickSms} style={css(`flex:1;padding:9px 10px;border-radius:9px;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;border:1.5px solid ${V.chanSms ? 'oklch(0.45 0.12 255)' : 'oklch(0.9 0.008 255)'};background:${V.chanSms ? 'oklch(0.96 0.02 250)' : '#fff'};color:${V.chanSms ? 'oklch(0.4 0.1 255)' : 'oklch(0.45 0.02 258)'};`)}>Text message<span style={css(`display:block;font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:400;margin-top:2px;color:oklch(0.6 0.02 258);`)}>Twilio SMS · recommended</span></button>
                  <button onClick={V.pickVoice} style={css(`flex:1;padding:9px 10px;border-radius:9px;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;border:1.5px solid ${V.chanVoice ? 'oklch(0.45 0.12 255)' : 'oklch(0.9 0.008 255)'};background:${V.chanVoice ? 'oklch(0.96 0.02 250)' : '#fff'};color:${V.chanVoice ? 'oklch(0.4 0.1 255)' : 'oklch(0.45 0.02 258)'};`)}>Voice call<span style={css(`display:block;font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:400;margin-top:2px;color:oklch(0.6 0.02 258);`)}>Twilio + ElevenLabs</span></button>
                  <button onClick={V.pickLink} style={css(`flex:1;padding:9px 10px;border-radius:9px;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;border:1.5px solid ${V.chanLink ? 'oklch(0.45 0.12 255)' : 'oklch(0.9 0.008 255)'};background:${V.chanLink ? 'oklch(0.96 0.02 250)' : '#fff'};color:${V.chanLink ? 'oklch(0.4 0.1 255)' : 'oklch(0.45 0.02 258)'};`)}>Secure link<span style={css(`display:block;font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:400;margin-top:2px;color:oklch(0.6 0.02 258);`)}>patient portal</span></button>
                </div>
                {(V.outreachPending) ? (<>
                  <p style={css(`margin:12px 0 0;font-size:12.5px;line-height:1.55;color:oklch(0.45 0.02 258);`)}>Praxess drafts the outreach; a person approves it. Nothing reaches Emory without your go-ahead, and his answer always comes back as patient-reported.</p>
                  <button onClick={V.approveOutreach} style={css(`margin-top:12px;width:100%;padding:11px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Approve &amp; send via {V.chanLabel}</button>
                </>) : null}
                {(V.awaitingReply) ? (<>
                  <div style={css(`margin-top:12px;display:flex;align-items:center;gap:9px;font-size:12.5px;color:oklch(0.5 0.08 155);font-weight:500;`)}><span style={css(`width:16px;height:16px;border-radius:50%;background:oklch(0.6 0.11 155);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;`)}>✓</span>Approved · dispatched via {V.chanLabel} · awaiting reply</div>
                </>) : null}
              </div>
            </>) : null}

            {(V.patientAnswered) ? (<>
              <div style={css(`background:#fff;border:1px solid oklch(0.85 0.05 155);border-radius:12px;padding:18px;animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
                <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.5 0.09 155);`)}>Response received</span>
                <p style={css(`margin:10px 0 0;font-size:15px;line-height:1.6;color:oklch(0.32 0.02 258);`)}>"I did about eight weeks of physical therapy at <strong style={css(`font-weight:600;`)}>Metro Physical Therapy</strong> earlier this year, from January through March."</p>
                <div style={css(`margin-top:16px;background:oklch(0.985 0.004 255);border:1px solid oklch(0.93 0.006 258);border-radius:9px;padding:12px 14px;`)}>
                  <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.7;color:oklch(0.45 0.02 258);`)}>
                    source: <span style={css(`color:oklch(0.55 0.13 250);`)}>patient</span> · verification: <span style={css(`color:oklch(0.65 0.09 70);`)}>patient-reported</span><br/>
                    → does <span style={css(`font-weight:600;`)}>not</span> auto-satisfy C5 · next action re-planned:
                  </div>
                  <div style={css(`margin-top:8px;font-size:13px;font-weight:600;color:oklch(0.3 0.02 258);`)}>Request records from Metro Physical Therapy.</div>
                </div>
                <button onClick={V.goDecision} style={css(`margin-top:14px;padding:10px 16px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>See re-planned action →</button>
              </div>
            </>) : null}
          </div>

          
          <div style={css(`justify-self:center;width:280px;background:oklch(0.22 0.02 258);border-radius:34px;padding:10px;box-shadow:0 20px 50px -20px oklch(0.4 0.05 258 / 0.5);`)}>
            <div style={css(`background:oklch(0.985 0.005 245);border-radius:26px;overflow:hidden;height:520px;display:flex;flex-direction:column;`)}>
              <div style={css(`padding:14px 18px 12px;background:oklch(0.45 0.12 255);color:#fff;`)}>
                <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.1em;opacity:0.8;`)}>PRAXESS · SECURE</div>
                <div style={css(`font-size:14px;font-weight:600;margin-top:3px;`)}>Quick question from your care team</div>
              </div>
              <div style={css(`flex:1;padding:16px;display:flex;flex-direction:column;gap:12px;overflow:auto;`)}>
                {(V.outreachPending) ? (<>
                  <div style={css(`flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:oklch(0.6 0.02 258);`)}>
                    <span style={css(`width:34px;height:34px;border-radius:50%;border:1.5px dashed oklch(0.8 0.02 255);display:flex;align-items:center;justify-content:center;font-size:14px;`)}>…</span>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;text-align:center;line-height:1.6;`)}>nothing sent yet<br/>awaiting clinician go-ahead</span>
                  </div>
                </>) : null}
                {(V.outreachApproved && V.chanVoice) ? (<>
                  <div style={css(`background:oklch(0.97 0.008 255);border:1px solid oklch(0.91 0.008 255);border-radius:12px;padding:12px 14px;animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
                    <div style={css(`display:flex;align-items:center;gap:10px;`)}>
                      <div style={css(`display:flex;align-items:flex-end;gap:2.5px;height:16px;`)}>
                        <span className="prx-eq" style={css(`width:3px;height:7px;border-radius:2px;background:oklch(0.45 0.12 255);`)}></span>
                        <span className="prx-eq" style={css(`width:3px;height:14px;border-radius:2px;background:oklch(0.45 0.12 255);animation-delay:.18s;`)}></span>
                        <span className="prx-eq" style={css(`width:3px;height:10px;border-radius:2px;background:oklch(0.45 0.12 255);animation-delay:.36s;`)}></span>
                      </div>
                      <div style={css(`font-size:12.5px;font-weight:600;color:oklch(0.35 0.03 258);`)}>Praxess care agent {V.patientAnswered ? '· call ended' : '· calling'}</div>
                    </div>
                    <div style={css(`margin-top:8px;font-size:12.5px;line-height:1.55;color:oklch(0.4 0.02 258);`)}>"Hi Emory, quick question from Dr. Reyes's office. Have you done any physical therapy for your back? Where, and for about how long?"</div>
                    <div style={css(`margin-top:6px;font-family:'IBM Plex Mono',monospace;font-size:9px;color:oklch(0.62 0.015 258);`)}>voice · ElevenLabs · consent line played first</div>
                  </div>
                </>) : null}
                {(V.outreachApproved && !V.chanVoice) ? (<>
                  <div style={css(`font-size:13px;line-height:1.5;color:oklch(0.34 0.02 258);animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>Have you done any physical therapy for your back? Where, and for about how long?</div>
                </>) : null}
                {(V.patientAnswered) ? (<>
                  <div style={css(`align-self:flex-end;max-width:85%;background:oklch(0.45 0.12 255);color:#fff;border-radius:14px 14px 4px 14px;padding:10px 13px;font-size:13px;line-height:1.5;animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>~8 weeks at Metro Physical Therapy, Jan–Mar.</div>
                  <div style={css(`align-self:center;font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.11 155);`)}>✓ captured · returned to care team as patient-reported</div>
                </>) : null}
                {(V.awaitingReply) ? (<>
                  <div style={css(`flex:1;`)}></div>
                  <div style={css(`display:flex;flex-direction:column;gap:8px;`)}>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.02 258);text-align:center;`)}>demo · patient replies</span>
                    <button onClick={V.patientRespond} style={css(`padding:12px;border-radius:12px;border:none;background:oklch(0.3 0.03 258);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Simulate patient reply</button>
                  </div>
                </>) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      </>) : null}

      
      {(V.isRecord) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;max-width:640px;`)}>
        <div style={css(`margin-bottom:20px;`)}>
          <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>05b · External record request</div>
          <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>Verify the patient-reported PT</h1>
        </div>
        <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;padding:20px;`)}>
          <div style={css(`display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid oklch(0.93 0.006 258);`)}>
            <div>
              <div style={css(`font-size:14px;font-weight:600;`)}>Metro Physical Therapy</div>
              <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.6 0.02 258);margin-top:2px;`)}>records request · course of PT, Jan–Mar</div>
            </div>
            <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:${V.recStatusColor};background:${V.recStatusBg};border:1px solid ${V.recStatusBorder};border-radius:20px;padding:4px 11px;`)}>{V.recStatusLabel}</span>
          </div>
          <div style={css(`padding-top:16px;`)}>
            {(V.recordPending) ? (<>
              <p style={css(`margin:0 0 14px;font-size:13px;line-height:1.6;color:oklch(0.45 0.02 258);`)}>A targeted release request has been sent. When the record returns, C5 upgrades from <span style={css(`font-family:'IBM Plex Mono',monospace;color:oklch(0.65 0.09 70);`)}>patient-reported</span> to <span style={css(`font-family:'IBM Plex Mono',monospace;color:oklch(0.55 0.11 155);`)}>documented · verified</span>.</p>
              <button onClick={V.receiveRecord} style={css(`padding:11px 18px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Simulate record returned</button>
            </>) : null}
            {(V.recordDone) ? (<>
              <div style={css(`display:flex;align-items:center;gap:10px;font-size:13px;color:oklch(0.5 0.09 155);font-weight:500;margin-bottom:14px;`)}><span style={css(`width:20px;height:20px;border-radius:50%;background:oklch(0.55 0.11 155);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;`)}>✓</span>PT summary received · 8 sessions verified · C5 satisfied</div>
              <button onClick={V.generateAndGo} style={css(`padding:11px 18px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Generate PA packet →</button>
            </>) : null}
          </div>
        </div>
      </div>
      </>) : null}

      
      {(V.isPacket) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
        <div style={css(`display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px;`)}>
          <div>
            <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>06 · Authorization packet</div>
            <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>Provenance-backed PA packet</h1>
          </div>
          <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;color:oklch(0.45 0.12 255);background:oklch(0.96 0.02 250);border:1px solid oklch(0.87 0.04 250);border-radius:8px;padding:7px 12px;`)}>STATUS · REVIEW-READY DRAFT</span>
        </div>

        <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;overflow:hidden;`)}>
          <div style={css(`padding:18px 22px;border-bottom:1px solid oklch(0.93 0.006 258);display:grid;grid-template-columns:1fr 1fr;gap:14px;`)}>
            <div><div style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.62 0.015 258);text-transform:uppercase;letter-spacing:0.08em;`)}>Requested service</div><div style={css(`font-size:14px;font-weight:600;margin-top:4px;`)}>MRI lumbar spine w/o contrast · 72148</div></div>
            <div><div style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.62 0.015 258);text-transform:uppercase;letter-spacing:0.08em;`)}>Payer</div><div style={css(`font-size:14px;font-weight:600;margin-top:4px;`)}>Meridian Health Plan · Commercial</div></div>
          </div>

          <div style={css(`padding:10px 22px 6px;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Criteria checklist · all supported</div>
          {V.criteria.map((c, _i0) => (<React.Fragment key={_i0}>
            <div style={css(`display:flex;align-items:center;gap:14px;padding:12px 22px;border-top:1px solid oklch(0.95 0.004 258);`)}>
              <span style={css(`width:22px;height:22px;border-radius:6px;background:oklch(0.95 0.03 155);color:oklch(0.5 0.1 155);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;`)}>✓</span>
              <div style={css(`flex:1;`)}>
                <div style={css(`font-size:13px;font-weight:500;color:oklch(0.32 0.02 258);`)}>{c.label}</div>
                <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.015 258);margin-top:2px;`)}>{c.packetSource}</div>
              </div>
              <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;background:${c.chipBg};color:${c.chipColor};border:1px solid ${c.chipBorder};white-space:nowrap;`)}>{c.packetTag}</span>
            </div>
          </React.Fragment>))}

          <div style={css(`padding:16px 22px;border-top:1px solid oklch(0.93 0.006 258);background:oklch(0.985 0.004 255);`)}>
            <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);margin-bottom:8px;`)}>Medical-necessity summary</div>
            <p style={css(`margin:0;font-size:13px;line-height:1.65;color:oklch(0.38 0.02 258);`)}>Chronic mechanical low-back pain &gt;6 months with documented failure of a structured conservative-therapy course — self-directed care (clinician-reviewed addendum) and a verified 8-session physical-therapy program — without neurologic deficit or red flags. Advanced imaging is indicated to evaluate for structural etiology. Every assertion below links to transcript, note, FHIR, patient response, or external record.</p>
          </div>

          <div style={css(`padding:16px 22px;border-top:1px solid oklch(0.93 0.006 258);display:flex;gap:10px;align-items:center;`)}>
            <span style={css(`flex:1;font-size:12px;color:oklch(0.55 0.02 258);`)}>Draft — the clinician reviews before submission. Praxess does not auto-submit.</span>
            <button onClick={V.downloadPacketPdf} style={css(`padding:12px 18px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;color:oklch(0.4 0.02 258);cursor:pointer;`)}>↓ Download packet · PDF</button>
            <button onClick={V.submitPacket} style={css(`padding:12px 22px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;`)}>Submit to Meridian →</button>
          </div>
        </div>
      </div>
      </>) : null}

      
      {(V.isLifecycle) ? (<>
      <div style={css(`animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
        <div style={css(`margin-bottom:22px;`)}>
          <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:oklch(0.55 0.13 250);margin-bottom:6px;`)}>07 · Submission &amp; appeals</div>
          <h1 style={css(`margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;`)}>The loop keeps running after submission</h1>
          <p style={css(`margin:6px 0 0;font-size:13px;color:oklch(0.55 0.02 258);max-width:600px;`)}>A payer response is just a new observation. Praxess updates the state and re-plans — approval, more-info, or appeal.</p>
        </div>

        <div style={css(`display:flex;align-items:center;gap:0;flex-wrap:wrap;margin-bottom:24px;`)}>
          {V.lifecycle.map((s, _i0) => (<React.Fragment key={_i0}>
            <div style={css(`display:flex;align-items:center;`)}>
              <div style={css(`display:flex;flex-direction:column;align-items:center;gap:7px;width:96px;`)}>
                <span style={css(`width:16px;height:16px;border-radius:50%;background:${s.dot};border:2px solid ${s.ring};`)}></span>
                <span style={css(`font-size:11px;text-align:center;line-height:1.3;color:${s.textColor};font-weight:${s.weight};`)}>{s.label}</span>
              </div>
              {(s.connector) ? (<>
                <span style={css(`width:26px;height:2px;background:${s.lineColor};margin-bottom:22px;`)}></span>
              </>) : null}
            </div>
          </React.Fragment>))}
        </div>

        <div style={css(`display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;`)}>
          {/* Left — selection panel OR locked-in status card */}
          {(!V.hasResponse) ? (
            <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;padding:18px;`)}>
              <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Simulate payer response</span>
              <div style={css(`display:flex;flex-direction:column;gap:9px;margin-top:12px;`)}>
                <button onClick={V.respApprove} style={css(`text-align:left;padding:12px 14px;border-radius:9px;border:1px solid oklch(0.85 0.05 155);background:oklch(0.98 0.02 155);cursor:pointer;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:oklch(0.4 0.06 155);transition:filter .12s;`)}>✓ Approved</button>
                <button onClick={V.respMore} style={css(`text-align:left;padding:12px 14px;border-radius:9px;border:1px solid oklch(0.86 0.05 75);background:oklch(0.98 0.02 75);cursor:pointer;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:oklch(0.45 0.06 60);transition:filter .12s;`)}>◐ More information requested</button>
                <button onClick={V.respDeny} style={css(`text-align:left;padding:12px 14px;border-radius:9px;border:1px solid oklch(0.86 0.06 25);background:oklch(0.98 0.02 25);cursor:pointer;font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:oklch(0.5 0.08 25);transition:filter .12s;`)}>✕ Denied</button>
              </div>
            </div>
          ) : (
            <div style={css(`background:${V.obsBg};border:1.5px solid ${V.obsBorder};border-radius:12px;padding:18px;animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
              <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${V.obsColor};`)}>Payer determination</span>
              <div style={css(`display:flex;align-items:center;gap:11px;margin-top:14px;margin-bottom:16px;`)}>
                <span style={css(`width:36px;height:36px;border-radius:10px;background:${V.obsColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;`)}>{V.obsIcon}</span>
                <span style={css(`font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${V.obsColor};`)}>{V.obsTitle}</span>
              </div>
              <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.8;color:oklch(0.45 0.02 258);background:#fff;border:1px solid ${V.obsBorder};border-radius:9px;padding:11px 13px;`)}>
                {V.obsDetailA}<br/><span style={css(`color:${V.obsColor};`)}>{V.obsDetailB}</span>
              </div>
              <button onClick={V.respReset} style={css(`margin-top:14px;width:100%;padding:9px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:500;color:oklch(0.55 0.02 258);cursor:pointer;letter-spacing:0.02em;`)}>↩ Roll back determination</button>
            </div>
          )}

          {/* Right — re-plan panel */}
          <div style={css(`background:#fff;border:1px solid ${V.obsBorder};border-radius:12px;padding:18px;min-height:180px;`)}>
            <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:oklch(0.6 0.02 258);`)}>Observe → update → re-plan</span>
            {(V.hasResponse) ? (<>
              <div style={css(`margin-top:12px;animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
                <div style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.8;color:oklch(0.45 0.02 258);background:oklch(0.985 0.004 255);border:1px solid oklch(0.93 0.006 258);border-radius:9px;padding:12px 14px;`)}>{V.obsDetailA}<br/><span style={css(`color:${V.obsColor};`)}>{V.obsDetailB}</span></div>
                <div style={css(`margin-top:12px;font-size:13px;color:oklch(0.35 0.02 258);`)}><strong style={css(`font-weight:600;`)}>Re-planned action:</strong> {V.obsAction}</div>
              </div>
            </>) : null}
            {(V.noResponse) ? (<>
              <div style={css(`margin-top:20px;font-size:13px;color:oklch(0.62 0.015 258);text-align:center;line-height:1.6;`)}>Waiting on payer.<br/>Select a response on the left to see Praxess re-plan.</div>
            </>) : null}
          </div>
        </div>

        {(V.isDenied) ? (<>
          <div style={css(`margin-top:24px;animation:prx-in .26s cubic-bezier(0.25,1,0.5,1) both;`)}>
            <div style={css(`display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;`)}>
              <h2 style={css(`margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em;`)}>Appeal workspace · same loop, new observation</h2>
              <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.55 0.12 25);`)}>appeal deadline · 14 days</span>
            </div>

            {/* The denial is an observation — capture WHY from the payer's letter */}
            <div style={css(`background:#fff;border:1px solid oklch(0.88 0.03 25);border-radius:11px;padding:14px 16px;margin-bottom:16px;`)}>
              <div style={css(`display:flex;gap:12px;align-items:flex-start;`)}>
                <div style={css(`flex:1;`)}>
                  <label style={css(`display:block;font-size:12.5px;font-weight:600;color:oklch(0.34 0.02 258);margin-bottom:6px;`)}>Denial reason — from the payer's letter</label>
                  <textarea
                    value={V.denialReason}
                    onChange={e => V.setDenialReason(e.target.value)}
                    placeholder="Paste or type the payer's stated reason, e.g. “The records do not document a sufficient trial of conservative therapy.”"
                    style={css(`width:100%;min-height:52px;border:1px solid oklch(0.9 0.01 255);border-radius:8px;padding:9px 11px;font-family:'IBM Plex Sans',sans-serif;font-size:13px;line-height:1.5;color:oklch(0.32 0.02 258);outline:none;resize:vertical;box-sizing:border-box;`)}
                  />
                </div>
                <div style={css(`width:190px;`)}>
                  <label style={css(`display:block;font-size:12.5px;font-weight:600;color:oklch(0.34 0.02 258);margin-bottom:6px;`)}>Denial reference</label>
                  <input
                    value={V.denialRef}
                    onChange={e => V.setDenialRef(e.target.value)}
                    placeholder="e.g. MHP-2026-0718-114"
                    style={css(`width:100%;border:1px solid oklch(0.9 0.01 255);border-radius:8px;padding:9px 11px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:oklch(0.32 0.02 258);outline:none;box-sizing:border-box;`)}
                  />
                  <div style={css(`margin-top:8px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.62 0.015 258);line-height:1.5;`)}>The letter rebuts this reason verbatim against the payer's own criteria.</div>
                </div>
              </div>
            </div>

            <div style={css(`display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;`)}>
              {V.appealCandidates.map((c, _iA) => (<React.Fragment key={_iA}>
                <div style={css(`background:#fff;border:1.5px solid ${c.recommended ? 'oklch(0.55 0.13 250)' : 'oklch(0.91 0.008 255)'};border-radius:11px;padding:13px 14px;`)}>
                  <div style={css(`display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;`)}>
                    <span style={css(`font-size:13px;font-weight:600;`)}>{c.title}</span>
                    <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:${c.recommended ? 'oklch(0.45 0.12 255)' : 'oklch(0.6 0.015 258)'};`)}>{c.ev.toFixed(2)}</span>
                  </div>
                  <div style={css(`font-size:11.5px;color:oklch(0.5 0.02 258);line-height:1.45;`)}>{c.desc}</div>
                  <div style={css(`margin-top:6px;font-family:'IBM Plex Mono',monospace;font-size:9px;color:oklch(0.62 0.015 258);`)}>{c.terms}</div>
                </div>
              </React.Fragment>))}
            </div>

            <div style={css(`display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start;`)}>
              <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;overflow:hidden;`)}>
                <div style={css(`padding:12px 16px;border-bottom:1px solid oklch(0.93 0.006 258);display:flex;align-items:center;justify-content:space-between;`)}>
                  <span style={css(`font-size:13px;font-weight:600;`)}>Appeal letter · drafted from the case state</span>
                  <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:${V.appealLetterApproved ? 'oklch(0.45 0.1 155)' : 'oklch(0.55 0.09 65)'};background:${V.appealLetterApproved ? 'oklch(0.96 0.03 155)' : 'oklch(0.97 0.04 75)'};border:1px solid ${V.appealLetterApproved ? 'oklch(0.86 0.05 155)' : 'oklch(0.88 0.05 75)'};border-radius:20px;padding:3px 10px;`)}>{V.appealLetterApproved ? 'CLINICIAN-APPROVED' : 'AWAITING APPROVAL'}</span>
                </div>
                <div style={css(`padding:16px;font-size:13px;line-height:1.65;color:oklch(0.32 0.02 258);`)}>
                  <p style={css(`margin:0 0 10px;`)}>Re: PA-4471 · MRI lumbar spine w/o contrast (72148){V.denialRef ? ` · denial ref ${V.denialRef}` : ''} · {V.denialReason ? `denial states: “${V.denialReason}”` : 'denial for insufficient conservative-therapy evidence.'}</p>
                  <p style={css(`margin:0 0 10px;`)}>The record now establishes the criterion the denial cites. The clinician-approved addendum documents self-directed conservative care: ibuprofen with good effect until the supply ran out, walking and heat <span style={css(`background:oklch(0.95 0.03 250);border-radius:3px;padding:0 3px;`)}>("ibuprofen for a while, which worked" — encounter transcript, verified span)</span>. The attached Metro Physical Therapy discharge summary verifies an <strong style={css(`font-weight:600;`)}>8-session course of physical therapy (Jan–Mar)</strong>, previously patient-reported and now record-verified. Red-flag screen and neurologic examination are documented in the clinical note.</p>
                  <p style={css(`margin:0;`)}>All five policy criteria are satisfied with source-linked evidence; we request reversal of the determination.</p>
                  <div style={css(`margin-top:12px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.015 258);border-top:1px dashed oklch(0.9 0.008 255);padding-top:10px;`)}>{V.appealPayerIntel}</div>
                </div>
                <div style={css(`padding:12px 16px;border-top:1px solid oklch(0.93 0.006 258);display:flex;gap:10px;background:oklch(0.985 0.004 255);`)}>
                  {(!V.appealLetterApproved) ? (<>
                    <button onClick={V.approveAppealLetter} style={css(`flex:1;padding:10px;border-radius:9px;border:none;background:oklch(0.55 0.11 155);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;`)}>✓ Approve letter</button>
                    <button onClick={V.downloadAppealPdf} style={css(`padding:10px 16px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:500;color:oklch(0.4 0.02 258);cursor:pointer;`)}>Download PDF</button>
                  </>) : null}
                  {(V.appealLetterApproved && !V.appealSubmitted) ? (<>
                    <button onClick={V.submitAppeal} style={css(`flex:1;padding:10px;border-radius:9px;border:none;background:oklch(0.45 0.12 255);color:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;`)}>File appeal with letter + records →</button>
                    <button onClick={V.downloadAppealPdf} style={css(`padding:10px 16px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:500;color:oklch(0.4 0.02 258);cursor:pointer;`)}>Download PDF</button>
                  </>) : null}
                  {(V.appealSubmitted) ? (<>
                    <div style={css(`flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;`)}>
                      <span style={css(`font-size:12.5px;color:oklch(0.5 0.09 155);font-weight:500;`)}>✓ Appeal filed · awaiting re-determination</span>
                      <button onClick={V.appealOverturned} style={css(`padding:9px 14px;border-radius:9px;border:1px solid oklch(0.85 0.05 155);background:oklch(0.98 0.02 155);font-family:'IBM Plex Sans',sans-serif;font-size:12px;font-weight:600;color:oklch(0.4 0.06 155);cursor:pointer;`)}>Simulate re-determination · overturned</button>
                    </div>
                  </>) : null}
                </div>
              </div>

              <div style={css(`background:#fff;border:1px solid oklch(0.91 0.008 255);border-radius:12px;padding:16px;`)}>
                <div style={css(`display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;`)}>
                  <span style={css(`font-size:13px;font-weight:600;`)}>Peer-to-peer call prep</span>
                  <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:10px;color:oklch(0.6 0.02 258);`)}>Dr. Reyes → payer medical director</span>
                </div>
                <div style={css(`display:flex;flex-direction:column;gap:8px;font-size:12.5px;line-height:1.5;color:oklch(0.38 0.02 258);`)}>
                  <div>1 · Denial reason is now moot: conservative-therapy course verified by external record (8 sessions, Metro PT).</div>
                  <div>2 · Criteria map: C1–C3 documented in note; C4 clinician-approved addendum; C5 record-verified.</div>
                  <div>3 · Every assertion is span-verified against transcript, note, FHIR, or the external record — offer to walk the sources live.</div>
                  <div>4 · Criteria family tracks ACR AC 2021 (payer intel); frame the case in ACR terms.</div>
                </div>
                {(!V.p2pPrepped) ? (<>
                  <button onClick={V.prepP2P} style={css(`margin-top:12px;width:100%;padding:10px;border-radius:9px;border:1px solid oklch(0.88 0.01 255);background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;font-weight:600;color:oklch(0.4 0.02 258);cursor:pointer;`)}>Mark prepped · request P2P slot</button>
                </>) : (<>
                  <div style={css(`margin-top:12px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:oklch(0.5 0.09 155);font-weight:500;`)}><span style={css(`width:16px;height:16px;border-radius:50%;background:oklch(0.6 0.11 155);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;`)}>✓</span>Prep sheet ready · P2P slot requested</div>
                </>)}
              </div>
            </div>
          </div>
        </>) : null}
      </div>
      </>) : null}

    </div>
    </main>
  </div>
</div>
    </>
  );
}
