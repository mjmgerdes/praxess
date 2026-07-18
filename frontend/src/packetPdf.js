// packetPdf — renders the PA evidence packet as a downloadable, submission-
// ready PDF. Text-native jsPDF (no DOM rasterization), letterhead layout.
// Every assertion carries its provenance label; patient-reported material is
// labeled as such; the document is stamped as a clinician-review draft on
// synthetic data. Content mirrors the packet screen one-for-one.
import { jsPDF } from 'jspdf'

const M = 56 // page margin (pt)
const INK = [42, 48, 62]
const MUTED = [122, 129, 143]
const BLUE = [64, 89, 200]
const GREEN = [63, 143, 99]
const AMBER = [173, 124, 51]
const LINE = [225, 227, 233]

// Verbatim evidence bank — every quote is a verified span from the dataset
// (transcript/note), the approved addendum, or the captured patient response.
const EVIDENCE = {
  C1: [
    ['CLINICAL NOTE', '"The pain is a dull band across the lower lumbar region, currently 4/10, dating to a lifting episode in college"'],
  ],
  C2: [
    ['CLINICAL NOTE', '"Mechanical, muscular pattern without red flags"'],
    ['TRANSCRIPT', '"No. It’s boring pain. Reliable, boring pain."'],
  ],
  C3: [
    ['CLINICAL NOTE', '"straight-leg raise negative bilaterally; lower-extremity strength, sensation, and reflexes intact. Gait normal."'],
  ],
  C4: [
    ['TRANSCRIPT', '"Walking. Hot showers. I had ibuprofen for a while, which worked, but the bottle ran out months ago and I never dealt with it."'],
    ['APPROVED ADDENDUM', 'Clinician-reviewed addendum documents the self-directed conservative-care trial and its cessation reason (supply ran out).'],
  ],
  C5: [
    ['PATIENT RESPONSE', '"I did about eight weeks of physical therapy at Metro Physical Therapy earlier this year, from January through March." (patient-reported)'],
    ['EXTERNAL RECORD', 'Metro Physical Therapy discharge summary — 8-session course verified (Jan–Mar).'],
  ],
}

const ADDENDUM_TEXT =
  'During the encounter, the patient reported using ibuprofen with good effect until the supply ran out several months ago, alongside walking and hot showers for symptom relief. The exact duration of this self-directed conservative care was not established during this visit.'

const summaryFor = ({ addendumApproved, recordReceived }) => {
  const conservative = addendumApproved
    ? 'a documented self-directed conservative-care course (clinician-reviewed addendum)'
    : 'a self-directed conservative-care history evidenced in the encounter transcript (addendum pending clinician review)'
  const pt = recordReceived
    ? ' and a record-verified 8-session physical-therapy program'
    : ''
  return `Chronic mechanical low-back pain with ${conservative}${pt}, without neurologic deficit or red flags. Advanced imaging is indicated to evaluate for structural etiology. Every assertion links to transcript, note, FHIR, patient response, or external record.`
}

const winAnsi = (t) => t.replace(/\u2265/g, '>=').replace(/\u2264/g, '<=').replace(/[\u2713\u2714]/g, '')

export function buildPacketPdf({ criteria, addendumApproved, patientAnswered, recordReceived }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  let y = M

  const rule = (yy) => { doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(M, yy, W - M, yy) }
  const ensure = (need) => { if (y + need > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M } }
  const mono = (size, color = MUTED) => { doc.setFont('courier', 'normal'); doc.setFontSize(size); doc.setTextColor(...color) }
  const sans = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color) }
  const para = (text, size, width = W - 2 * M, style = 'normal', color = INK, lh = 1.45) => {
    sans(size, style, color)
    const lines = doc.splitTextToSize(text, width)
    ensure(lines.length * size * lh)
    doc.text(lines, M, y)
    y += lines.length * size * lh
  }

  // ---- letterhead ----
  doc.setFillColor(...BLUE); doc.roundedRect(M, y - 2, 18, 18, 4, 4, 'F')
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(1.4); doc.circle(M + 9, y + 7, 3.4, 'S')
  sans(16, 'bold'); doc.text('Praxess', M + 26, y + 12)
  mono(8); doc.text('PRIOR-AUTHORIZATION EVIDENCE PACKET', W - M, y + 3, { align: 'right' })
  mono(8, AMBER); doc.text('REVIEW-READY DRAFT · CLINICIAN REVIEW REQUIRED', W - M, y + 14, { align: 'right' })
  y += 34; rule(y); y += 22

  // ---- case block ----
  const kv = [
    ['PATIENT', 'Kovacek, Emory · 22M (synthetic)'],
    ['CASE', 'PA-4471'],
    ['REQUESTED SERVICE', 'MRI lumbar spine w/o contrast · CPT 72148'],
    ['PAYER', 'Meridian Health Plan · Commercial'],
    ['GENERATED', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })],
  ]
  kv.forEach(([k, v]) => {
    mono(7.5); doc.text(k, M, y)
    sans(10.5, 'normal'); doc.text(v, M + 130, y)
    y += 16
  })
  y += 6; rule(y); y += 22

  // ---- medical necessity ----
  mono(8, BLUE); doc.text('MEDICAL-NECESSITY SUMMARY', M, y); y += 14
  para(summaryFor({ addendumApproved, recordReceived }), 10.5)
  y += 10

  // ---- criteria checklist ----
  const nSupported = criteria.filter(c => ['Documented', 'Verified'].includes(c.packetTag)).length
  const critHeader = nSupported === criteria.length
    ? 'PAYER CRITERIA · ALL SUPPORTED'
    : `PAYER CRITERIA · ${nSupported} OF ${criteria.length} SUPPORTED`
  mono(8, BLUE); doc.text(critHeader, M, y); y += 16
  criteria.forEach((c) => {
    ensure(46)
    doc.setFillColor(...(c.packetTag === 'Patient-reported' ? AMBER : GREEN))
    doc.circle(M + 5, y - 3, 4, 'F')
    sans(10.5, 'bold'); doc.text(winAnsi(`${c.id} · ${c.label}`), M + 18, y)
    mono(8, GREEN); doc.text(c.packetTag.toUpperCase(), W - M, y, { align: 'right' })
    y += 13
    mono(8); doc.text(`source · ${c.packetSource}`, M + 18, y)
    y += 12
    let ev = EVIDENCE[c.id] || []
    if (c.id === 'C4' && !addendumApproved) ev = ev.filter(([src]) => src !== 'APPROVED ADDENDUM')
    if (c.id === 'C5') {
      if (!patientAnswered) ev = ev.filter(([src]) => src !== 'PATIENT RESPONSE')
      if (!recordReceived) ev = ev.filter(([src]) => src !== 'EXTERNAL RECORD')
      if (!ev.length) ev = [['STATUS', 'Not yet established in any source — unknown never becomes no.']]
    }
    ev.forEach(([src, quote]) => {
      sans(9, 'normal', [90, 97, 112])
      const lines = doc.splitTextToSize(quote, W - 2 * M - 96)
      ensure(lines.length * 12 + 4)
      mono(7, BLUE); doc.text(src, M + 18, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 97, 112)
      doc.text(lines, M + 96, y)
      y += Math.max(12, lines.length * 12)
    })
    y += 8
  })

  y += 2; rule(y); y += 20

  // ---- addendum ----
  if (addendumApproved) {
    mono(8, BLUE); doc.text('CLINICIAN-APPROVED NOTE ADDENDUM', M, y); y += 14
    para(ADDENDUM_TEXT, 10, W - 2 * M, 'italic')
    mono(8, GREEN); ensure(14); doc.text('STATUS · CLINICIAN-REVIEWED · PAYER-VISIBLE', M, y); y += 20
  }

  // ---- external record ----
  if (recordReceived) {
    mono(8, BLUE); doc.text('ATTACHED EXTERNAL RECORD', M, y); y += 14
    para('Metro Physical Therapy — discharge summary. 8-session physical-therapy course, January–March. Converts the patient-reported history to record-verified evidence.', 10)
    y += 10
  }

  // ---- footer disclaimer ----
  ensure(60); rule(y); y += 16
  para(
    'Draft prepared by Praxess for clinician review; Praxess does not submit to payers or guarantee determinations. Patient-reported information is labeled and is not presented as clinician-observed. Built on organizer-provided synthetic data (Abridge hackathon corpus) — demonstration document, not for clinical use.',
    8, W - 2 * M, 'normal', MUTED, 1.5
  )

  doc.save('praxess-PA-4471-evidence-packet.pdf')
}
