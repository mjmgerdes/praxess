// appealPdf — first-level appeal letter as a submission-grade PDF.
// Same mechanism as the packet: query the payer requirements (payer-intel +
// policy criteria), bind the provider-entered denial reason to the verified
// case evidence, and emit a formal letter — letterhead, RE block, rebuttal of
// the stated denial basis, criterion-by-criterion compliance, risks of
// non-treatment, demand for reversal, signature block. Draft: a clinician
// signs before anything is filed.
import { jsPDF } from 'jspdf'
import { CASE, CRITERIA_DESC, EVIDENCE } from './packetPdf.js'

const wa = (t) => String(t).replace(/≥/g, '>=').replace(/[✓✔]/g, '')

const SATISFIED = 'This criterion is satisfied.'

function criterionVerdict(tag) {
  if (tag === 'Verified' || tag === 'Documented') return SATISFIED
  if (tag === 'Patient-reported') {
    return 'This criterion is supported by patient-reported history; the corroborating treatment record has been requested and will be supplied upon receipt.'
  }
  return 'This criterion is addressed by the enclosed documentation and the clinical narrative above.'
}

export function buildAppealDoc({
  criteria,
  denialReason,
  denialRef,
  addendumApproved,
  patientAnswered,
  recordReceived,
  payerRequirements, // one-line citation of the payer's criteria source (from payer intel)
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 64
  const CW = W - 2 * M
  const FOOT = 58

  const INK = [33, 37, 41]
  const MUTED = [120, 126, 134]
  const NAVY = [36, 56, 133]
  const AMBER = [158, 108, 32]
  const LINE = [214, 217, 222]

  let y = M

  const sans = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const serif = (size, style = 'normal', color = INK) => { doc.setFont('times', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const ensure = (need) => { if (y + need > H - FOOT) { doc.addPage(); y = M } }
  const para = (text, opts = {}) => {
    const { size = 11, style = 'normal', gap = 10, x = M, width = CW } = opts
    serif(size, style)
    const lines = doc.splitTextToSize(wa(text), width)
    ensure(lines.length * size * 1.45)
    doc.text(lines, x, y)
    y += lines.length * size * 1.45 + gap
  }
  const heading = (text) => {
    ensure(34)
    y += 6
    serif(11, 'bold')
    const lines = doc.splitTextToSize(wa(text), CW)
    doc.text(lines, M, y)
    y += lines.length * 16 + 8
  }

  // ─── letterhead ───────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY); doc.roundedRect(M, y - 4, 18, 18, 4, 4, 'F')
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(1.4); doc.circle(M + 9, y + 5, 3.4, 'S')
  sans(14, 'bold'); doc.text(CASE.provider.split(' · ')[1] ?? 'Lakeview Orthopedic & Spine', M + 26, y + 9)
  sans(8.5, 'normal', MUTED)
  doc.text(wa(`${CASE.provider.split(' · ')[0]} · NPI ${CASE.npi} · prepared with Praxess`), M + 26, y + 21)
  const chipW = 172
  doc.setFillColor(252, 245, 231); doc.setDrawColor(...AMBER); doc.setLineWidth(0.7)
  doc.roundedRect(W - M - chipW, y - 4, chipW, 15, 3, 3, 'FD')
  sans(7, 'bold', AMBER); doc.text('DRAFT — PENDING CLINICIAN SIGNATURE', W - M - chipW / 2, y + 6, { align: 'center' })
  y += 34
  doc.setDrawColor(...NAVY); doc.setLineWidth(1.2); doc.line(M, y, W - M, y)
  y += 24

  // ─── date · addressee · RE block ─────────────────────────────────────────
  para(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), { gap: 14 })
  para(`${CASE.payer.split(' · ')[0]}\nPrior Authorization Review Department\nVia ${CASE.reviewPath.split(' · ')[0]}`, { gap: 14 })

  serif(11, 'bold')
  const re = [
    'RE: First Level Appeal — Prior Authorization Denial',
    `Denial Reference: ${denialRef || '[payer denial reference]'}`,
    `Procedure: ${CASE.service} (CPT ${CASE.cpt})`,
    `Diagnosis: ${CASE.icd}`,
    `Patient: ${CASE.patient} · DOB ${CASE.dobSex.split(' · ')[0]} · Member ${CASE.memberId}`,
    `Case: ${CASE.ref}`,
  ]
  re.forEach((line) => { ensure(16); doc.text(wa(line), M, y); y += 16 })
  y += 12

  para('Dear Prior Authorization Review Board,')
  para(
    `We write to formally appeal the denial referenced above for prior authorization of ${CASE.service} (CPT ${CASE.cpt}) on behalf of our patient ${CASE.patient.split(',').reverse().join(' ').trim()}. The documented clinical record satisfies, point by point, the medical-necessity criteria your plan applies to this service (${payerRequirements}). We respectfully request that the denial be reversed and authorization issued without further delay.`
  )

  // ─── I. rebuttal of the stated denial basis ──────────────────────────────
  heading('I. THE STATED DENIAL BASIS, ADDRESSED DIRECTLY')
  para(
    denialReason
      ? `The denial states: "${denialReason.trim()}"`
      : 'The denial cites insufficient documentation of the conservative-therapy requirement.',
    { style: 'italic' }
  )
  const rebuttals = []
  if (addendumApproved) {
    rebuttals.push(
      'The clinician-approved note addendum documents the self-directed conservative-care course — ibuprofen with good effect until the supply ran out, alongside walking and heat — grounded in the verbatim encounter transcript ("I had ibuprofen for a while, which worked, but the bottle ran out months ago"). This history is not absent from the record; it is documented and clinician-reviewed.'
    )
  }
  if (recordReceived) {
    rebuttals.push(
      'The enclosed Metro Physical Therapy discharge summary verifies a completed 8-session physical-therapy course (January–March). This element was patient-reported at intake and is now record-verified by the treating facility’s own documentation.'
    )
  } else if (patientAnswered) {
    rebuttals.push(
      'The patient has identified a completed physical-therapy course (approximately eight weeks at Metro Physical Therapy, January–March). The discharge summary has been requested from the facility and will be forwarded on receipt; it is identified, not speculative.'
    )
  }
  rebuttals.push(
    'The red-flag and neurologic screen is documented in the signed encounter note: straight-leg raise negative bilaterally, lower-extremity strength, sensation, and reflexes intact, gait normal.'
  )
  rebuttals.forEach((r, i) => para(`${['First', 'Second', 'Third', 'Fourth'][i]}: ${r}`))

  // ─── II. criterion-by-criterion compliance ───────────────────────────────
  heading('II. CRITERION-BY-CRITERION COMPLIANCE WITH THE PLAN’S PUBLISHED REQUIREMENTS')
  para(`The plan’s criteria for CPT ${CASE.cpt} (${payerRequirements}) are addressed in turn.`)
  criteria.forEach((c, i) => {
    const desc = CRITERIA_DESC[c.id] || c.label
    para(`Criterion ${i + 1}: ${desc}`, { style: 'bold', gap: 4 })
    const ev = (EVIDENCE[c.id] || [])
      .filter(([src]) => (src !== 'ADDENDUM' || addendumApproved))
      .filter(([src]) => (src !== 'PATIENT RESPONSE' || patientAnswered))
      .filter(([src]) => (src !== 'EXTERNAL RECORD' || recordReceived))
    const cites = ev.map(([src, loc, quote]) => `${quote} (${loc})`).join(' ')
    para(`${cites} ${criterionVerdict(c.packetTag)}`, { gap: 12 })
  })

  // ─── III. medical necessity and risks of delay ───────────────────────────
  heading('III. MEDICAL NECESSITY AND THE COST OF DELAY')
  para(
    'This patient presents with chronic mechanical low back pain producing documented functional limitation — pain aggravated by the prolonged sitting his work requires, with symptom escalation across the workweek. Conservative measures available to him have been exhausted or exceeded, as documented above. Advanced imaging is the indicated next step to evaluate for structural etiology and to determine candidacy for further intervention; continued denial does not preserve a conservative alternative, it forecloses the evidence-based pathway his treating clinician has determined is necessary.'
  )

  // ─── IV. demand for reversal ─────────────────────────────────────────────
  heading('IV. REQUEST FOR REVERSAL AND NOTICE OF FURTHER ACTION')
  para(
    `We request that the denial referenced above be reversed and authorization issued for ${CASE.service} (CPT ${CASE.cpt}) within the timeframe applicable to this plan. Should this first-level appeal be denied without a specific, criterion-by-criterion explanation of which documented findings are considered insufficient and why, we will pursue the remedies available to the member, including a second-level internal appeal and independent external review. We are prepared to provide any additional documentation the reviewer requires, and we request that review be assigned to a physician reviewer whose specialty is consistent with the treating provider’s.`
  )

  para('Sincerely,', { gap: 34 })
  ensure(50)
  doc.setDrawColor(...INK); doc.setLineWidth(0.8); doc.line(M, y, M + 210, y)
  y += 12
  sans(8.5, 'normal', MUTED)
  doc.text(wa(`${CASE.provider} · NPI ${CASE.npi}`), M, y); y += 12
  doc.text(wa(`cc: ${CASE.patient.split(',').reverse().join(' ').trim()}, patient`), M, y)

  // ─── per-page footer ──────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(...LINE); doc.setLineWidth(0.7); doc.line(M, H - 42, W - M, H - 42)
    doc.setFont('courier', 'normal'); doc.setFontSize(7); doc.setTextColor(166, 171, 178)
    doc.text(wa(`Appeal draft · Case ${CASE.ref} · prepared with Praxess`), M, H - 29)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 29, { align: 'right' })
    doc.text('Synthetic demonstration data — not for clinical use or payer submission.', M, H - 19)
  }

  return { doc, filename: `praxess-${CASE.ref}-appeal-letter.pdf` }
}

export function buildAppealPdf(opts) {
  const { doc, filename } = buildAppealDoc(opts)
  doc.save(filename)
}
