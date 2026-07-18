// packetPdf — renders the PA evidence packet as a submission-grade PDF.
// Text-native jsPDF (no DOM rasterization). Structured like a real payer
// submission: request summary grid, medical-necessity narrative, criteria
// dispositions with cited verbatim evidence, attachments index, attestation.
// Every assertion carries its provenance label; patient-reported material is
// labeled as such; the document is stamped as a clinician-review draft on
// synthetic data. Content mirrors the packet screen one-for-one.
import { jsPDF } from 'jspdf'

// ─── DEMO CASE — single place to swap when the demo case changes ───────────
const CASE = {
  ref: 'PA-4471',
  patient: 'Kovacek, Emory',
  dobSex: '01/14/2004 · 22 · M',
  memberId: 'MHP-88231-04 (synthetic)',
  ageSexPhrase: '22-year-old man',
  provider: 'A. Verma, MD · Lakeview Orthopedic & Spine',
  npi: '1922334455 (synthetic)',
  service: 'MRI lumbar spine without contrast',
  cpt: '72148',
  icd: 'M54.50 — Low back pain, unspecified',
  payer: 'Meridian Health Plan · Commercial',
  reviewPath: 'eviCore (RBM) · ACR Appropriateness Criteria 2021',
  urgency: 'Standard',
  pos: 'Outpatient imaging',
}

const CRITERIA_DESC = {
  C1: 'Low back pain persisting 6+ weeks despite conservative management.',
  C2: 'Absence of red-flag pathology (bowel/bladder dysfunction, saddle anesthesia, progressive deficit, fever, malignancy history).',
  C3: 'Current neurologic examination documented.',
  C4: '6+ weeks of self-directed or provider-directed conservative care.',
  C5: 'Completed course of provider-directed physical therapy, with provider/facility and dates identified.',
}

// Verbatim evidence bank — every quote is a verified span from the dataset
// (transcript/note), the approved addendum, or the captured patient response.
// [source tag, location, quote, patientReported?]
const EVIDENCE = {
  C1: [
    ['CLINICAL NOTE', 'Encounter note — Subjective', '"The pain is a dull band across the lower lumbar region, currently 4/10, dating to a lifting episode in college"'],
  ],
  C2: [
    ['CLINICAL NOTE', 'Encounter note — Assessment', '"Mechanical, muscular pattern without red flags"'],
    ['TRANSCRIPT', 'Encounter transcript — patient', '"No. It’s boring pain. Reliable, boring pain."'],
  ],
  C3: [
    ['CLINICAL NOTE', 'Encounter note — Physical exam', '"straight-leg raise negative bilaterally; lower-extremity strength, sensation, and reflexes intact. Gait normal."'],
  ],
  C4: [
    ['TRANSCRIPT', 'Encounter transcript — patient', '"Walking. Hot showers. I had ibuprofen for a while, which worked, but the bottle ran out months ago and I never dealt with it."'],
    ['ADDENDUM', 'Clinician-approved note addendum', 'Documents the self-directed conservative-care trial and its cessation reason (supply ran out).'],
  ],
  C5: [
    ['PATIENT RESPONSE', 'Secure patient message — captured by Praxess', '"I did about eight weeks of physical therapy at Metro Physical Therapy earlier this year, from January through March."', true],
    ['EXTERNAL RECORD', 'Metro Physical Therapy — discharge summary', '8-session physical-therapy course verified (Jan–Mar). Converts the patient-reported history to record-verified evidence.'],
  ],
}

const ADDENDUM_TEXT =
  'During the encounter, the patient reported using ibuprofen with good effect until the supply ran out several months ago, alongside walking and hot showers for symptom relief. The exact duration of this self-directed conservative care was not established during this visit.'

const narrativeFor = ({ addendumApproved, recordReceived, nSupported, nTotal }) => {
  const conservative = addendumApproved
    ? 'a self-directed conservative-care course documented in a clinician-reviewed note addendum'
    : 'a self-directed conservative-care history evidenced in the encounter transcript (addendum pending clinician review)'
  const pt = recordReceived
    ? ', and a completed 8-session physical-therapy program verified against the treating facility’s discharge summary'
    : ''
  const coverage = nSupported === nTotal
    ? `All ${nTotal} applicable medical-necessity criteria are supported by the cited sources.`
    : `${nSupported} of ${nTotal} applicable medical-necessity criteria are currently supported; outstanding items are identified in Section 3 and are not presented as satisfied.`
  return (
    `${CASE.patient.split(',')[0]} is a ${CASE.ageSexPhrase} with chronic mechanical low back pain, without neurologic deficit ` +
    `or red-flag findings on current examination. The record establishes symptom chronicity, a negative red-flag and ` +
    `neurologic screen, ${conservative}${pt}. Under the plan’s criteria for CPT ${CASE.cpt} ` +
    `(${CASE.reviewPath.split(' · ')[1]}), advanced imaging is indicated to evaluate for structural etiology after ` +
    `conservative measures. ${coverage} Each assertion below is linked to its verbatim source: encounter transcript, ` +
    `clinical note, structured FHIR record, patient response, or external treatment record.`
  )
}

// jsPDF core fonts are WinAnsi — strip the few glyphs outside it.
const wa = (t) => String(t).replace(/≥/g, '6+').replace(/[✓✔]/g, '').replace(/·/g, '·')

export function buildPacketDoc({ criteria, addendumApproved, patientAnswered, recordReceived }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 54
  const CW = W - 2 * M
  const FOOT = 64 // reserved footer band

  const INK = [33, 37, 41]
  const MUTED = [120, 126, 134]
  const FAINT = [166, 171, 178]
  const NAVY = [36, 56, 133]
  const GREEN = [43, 118, 79]
  const AMBER = [158, 108, 32]
  const LINE = [214, 217, 222]
  const WASH = [246, 247, 249]

  let y = M

  const sans = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const serif = (size, style = 'normal', color = INK) => { doc.setFont('times', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const mono = (size, color = MUTED, style = 'normal') => { doc.setFont('courier', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const rule = (yy, color = LINE, wgt = 0.7) => { doc.setDrawColor(...color); doc.setLineWidth(wgt); doc.line(M, yy, W - M, yy) }
  const ensure = (need) => { if (y + need > H - FOOT) { doc.addPage(); y = M } }

  const sectionHead = (n, title) => {
    ensure(40)
    y += 6
    sans(8, 'bold', NAVY)
    doc.text(`SECTION ${n}`, M, y)
    sans(11.5, 'bold', INK)
    doc.text(wa(title), M + 70, y)
    y += 8
    rule(y, LINE, 0.9)
    y += 18
  }

  const serifPara = (text, size = 10.5, lh = 1.5, style = 'normal', color = INK, x = M, width = CW) => {
    serif(size, style, color)
    const lines = doc.splitTextToSize(wa(text), width)
    ensure(lines.length * size * lh)
    doc.text(lines, x, y)
    y += lines.length * size * lh
  }

  // ─── letterhead ───────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY); doc.roundedRect(M, y - 3, 20, 20, 4, 4, 'F')
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(1.5); doc.circle(M + 10, y + 7, 3.8, 'S')
  sans(17, 'bold'); doc.text('Praxess', M + 28, y + 12)
  sans(8, 'normal', MUTED); doc.text('Prior-authorization preparation · conversation-grounded evidence', M + 28, y + 24)

  sans(8, 'bold', NAVY); doc.text('PRIOR AUTHORIZATION REQUEST', W - M, y + 2, { align: 'right' })
  sans(8, 'normal', MUTED); doc.text('SUPPORTING EVIDENCE PACKET', W - M, y + 13, { align: 'right' })
  // draft chip
  const chipW = 178
  doc.setFillColor(252, 245, 231); doc.setDrawColor(...AMBER); doc.setLineWidth(0.7)
  doc.roundedRect(W - M - chipW, y + 20, chipW, 15, 3, 3, 'FD')
  sans(7, 'bold', AMBER); doc.text('DRAFT — PENDING CLINICIAN SIGNATURE', W - M - chipW / 2, y + 30, { align: 'center' })
  y += 48; rule(y, NAVY, 1.4); y += 20

  // ─── addressee ────────────────────────────────────────────────────────────
  sans(9.5, 'bold'); doc.text(wa(`To: ${CASE.payer} — Utilization Management`), M, y); y += 13
  sans(9.5, 'normal', MUTED); doc.text(wa(`Via: ${CASE.reviewPath.split(' · ')[0]}`), M, y)
  sans(9.5, 'normal', MUTED); doc.text(
    `Date of request: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    W - M, y, { align: 'right' })
  y += 13
  sans(9.5, 'bold'); doc.text(wa(`Re: ${CASE.service} (CPT ${CASE.cpt}) · Case ${CASE.ref}`), M, y); y += 10

  // ─── section 1 · request summary grid ────────────────────────────────────
  sectionHead(1, 'Request summary')
  const rows = [
    [['PATIENT', CASE.patient], ['MEMBER ID', CASE.memberId]],
    [['DOB · AGE · SEX', CASE.dobSex], ['CASE REFERENCE', CASE.ref]],
    [['REQUESTING PROVIDER', CASE.provider], ['NPI', CASE.npi]],
    [['DIAGNOSIS (ICD-10)', CASE.icd], ['REQUESTED SERVICE', `${CASE.service} · CPT ${CASE.cpt}`]],
    [['PAYER · PLAN', CASE.payer], ['REVIEW PATHWAY', CASE.reviewPath]],
    [['URGENCY', CASE.urgency], ['PLACE OF SERVICE', CASE.pos]],
  ]
  const rowH = 26, colW = CW / 2
  ensure(rows.length * rowH + 6)
  doc.setDrawColor(...LINE); doc.setLineWidth(0.7)
  rows.forEach((cols, ri) => {
    const ry = y + ri * rowH
    if (ri % 2 === 0) { doc.setFillColor(...WASH); doc.rect(M, ry, CW, rowH, 'F') }
    cols.forEach(([k, v], ci) => {
      const x = M + ci * colW + 10
      sans(6.5, 'bold', FAINT); doc.text(k, x, ry + 10)
      sans(9, 'normal', INK)
      const fit = doc.splitTextToSize(wa(v), colW - 20)
      doc.text(fit.length > 1 ? fit[0].replace(/\s+\S*$/, '') + '…' : fit[0], x, ry + 20)
    })
  })
  doc.rect(M, y, CW, rows.length * rowH, 'S')
  doc.line(M + colW, y, M + colW, y + rows.length * rowH)
  y += rows.length * rowH + 8

  // ─── section 2 · medical necessity ────────────────────────────────────────
  const nTotal = criteria.length
  const supported = criteria.filter(c => ['Documented', 'Verified'].includes(c.packetTag))
  const nSupported = supported.length
  sectionHead(2, 'Statement of medical necessity')
  serifPara(narrativeFor({ addendumApproved, recordReceived, nSupported, nTotal }), 10.5)
  y += 6

  // ─── section 3 · criteria dispositions ────────────────────────────────────
  sectionHead(3, `Payer criteria — ${nSupported === nTotal ? 'all supported' : `${nSupported} of ${nTotal} supported`}`)
  criteria.forEach((c) => {
    ensure(56)
    // disposition chip
    const tag = c.packetTag.toUpperCase()
    const tone = c.packetTag === 'Patient-reported' ? AMBER : (['Documented', 'Verified'].includes(c.packetTag) ? GREEN : MUTED)
    sans(10.5, 'bold'); doc.text(wa(`${c.id}  ${c.label}`), M, y)
    mono(7.5, tone, 'bold'); doc.text(`[ ${wa(tag)} ]`, W - M, y, { align: 'right' })
    y += 12
    if (CRITERIA_DESC[c.id]) {
      sans(8.5, 'normal', MUTED)
      const dl = doc.splitTextToSize(wa(CRITERIA_DESC[c.id]), CW - 10)
      ensure(dl.length * 11)
      doc.text(dl, M, y); y += dl.length * 11
    }
    y += 3

    let ev = EVIDENCE[c.id] || []
    if (c.id === 'C4' && !addendumApproved) ev = ev.filter(([src]) => src !== 'ADDENDUM')
    if (c.id === 'C5') {
      if (!patientAnswered) ev = ev.filter(([src]) => src !== 'PATIENT RESPONSE')
      if (!recordReceived) ev = ev.filter(([src]) => src !== 'EXTERNAL RECORD')
      if (!ev.length) ev = [['STATUS', 'Praxess case state', 'Not yet established in any source. Recorded as unknown — unknown never becomes no.', true]]
    }
    ev.forEach(([src, loc, quote, patientReported]) => {
      serif(9.5)
      const qw = CW - 26
      const lines = doc.splitTextToSize(wa(quote), qw)
      const boxH = lines.length * 12.5 + 22
      ensure(boxH + 6)
      doc.setFillColor(...WASH); doc.rect(M + 8, y - 4, CW - 8, boxH, 'F')
      doc.setFillColor(...(patientReported ? AMBER : NAVY)); doc.rect(M + 8, y - 4, 2.5, boxH, 'F')
      mono(6.8, patientReported ? AMBER : NAVY, 'bold'); doc.text(wa(src), M + 18, y + 5)
      mono(6.8, FAINT); doc.text(wa(`· ${loc}`), M + 22 + doc.getTextWidth(wa(src)), y + 5)
      if (patientReported) { mono(6.8, AMBER, 'bold'); doc.text('PATIENT-REPORTED — REQUIRES VERIFICATION', W - M - 8, y + 5, { align: 'right' }) }
      serif(9.5, 'normal', [72, 78, 86]); doc.text(lines, M + 18, y + 18)
      y += boxH + 5
    })
    y += 9
  })

  // ─── section 4 · clinician addendum ───────────────────────────────────────
  if (addendumApproved) {
    sectionHead(4, 'Clinician-approved note addendum')
    serif(10, 'italic')
    const al = doc.splitTextToSize(wa(ADDENDUM_TEXT), CW - 28)
    const abH = al.length * 13 + 30
    ensure(abH)
    doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.setFillColor(252, 252, 253)
    doc.roundedRect(M, y - 6, CW, abH, 3, 3, 'FD')
    serif(10, 'italic', [60, 66, 74]); doc.text(al, M + 14, y + 10)
    mono(7, GREEN, 'bold'); doc.text('CLINICIAN-REVIEWED · ELECTRONIC APPROVAL ON FILE · PAYER-VISIBLE', M + 14, y + abH - 16)
    y += abH + 8
  }

  // ─── section 5 · attachments index ────────────────────────────────────────
  sectionHead(addendumApproved ? 5 : 4, 'Supporting documentation index')
  const attachments = [
    ['A1', 'Encounter clinical note (ambient-drafted, clinician-signed)'],
    ['A2', 'Encounter transcript — verbatim spans cited in Section 3'],
  ]
  if (addendumApproved) attachments.push(['A3', 'Clinician-approved note addendum (Section 4)'])
  if (recordReceived) attachments.push([`A${attachments.length + 1}`, 'Metro Physical Therapy — discharge summary (external record, verifies patient-reported course)'])
  attachments.push([`A${attachments.length + 1}`, 'Structured FHIR extract — conditions, medications, observations for this encounter'])
  attachments.forEach(([tag, label]) => {
    ensure(15)
    mono(8, NAVY, 'bold'); doc.text(tag, M, y)
    sans(9.5, 'normal', INK); doc.text(wa(label), M + 30, y)
    y += 15
  })
  y += 4

  // ─── attestation ──────────────────────────────────────────────────────────
  const attestation =
    'The information in this request was assembled from the encounter record and the sources cited above. Verbatim quotations were mechanically verified against their claimed source documents before inclusion. Patient-reported information is labeled as such and is not presented as clinician-observed. This packet is a draft prepared for clinician review; it has not been submitted.'
  // keep header + attestation + signature block together — no orphan header or signature page
  serif(9.5)
  const attLines = doc.splitTextToSize(wa(attestation), CW).length
  ensure(40 + attLines * 9.5 * 1.5 + 84)
  sectionHead(addendumApproved ? 6 : 5, 'Attestation')
  serifPara(attestation, 9.5, 1.5, 'normal', [72, 78, 86])
  y += 20
  doc.setDrawColor(...INK); doc.setLineWidth(0.8)
  doc.line(M, y, M + 200, y)
  doc.line(W - M - 140, y, W - M, y)
  y += 11
  sans(7.5, 'normal', MUTED)
  doc.text('Requesting clinician signature', M, y)
  doc.text('Date', W - M - 140, y)
  y += 8

  // ─── per-page footer ──────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  const stamp = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    rule(H - 44, LINE, 0.7)
    mono(7, FAINT)
    doc.text(wa(`Praxess · Case ${CASE.ref} · generated ${stamp}`), M, H - 30)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 30, { align: 'right' })
    doc.text('Synthetic demonstration data — not for clinical use or payer submission.', M, H - 19)
  }

  return { doc, filename: `praxess-${CASE.ref}-evidence-packet.pdf` }
}

export function buildPacketPdf(opts) {
  const { doc, filename } = buildPacketDoc(opts)
  doc.save(filename)
}
