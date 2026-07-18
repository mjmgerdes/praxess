import fs from "fs";
import path from "path";
import type { PayerPolicy, SourceDocs } from "./types";

type FhirResource = Record<string, any>;

function dateOnly(iso?: string): string {
  return iso ? iso.slice(0, 10) : "date unknown";
}

function codeText(cc: any): string {
  return cc?.text ?? cc?.coding?.[0]?.display ?? "unknown";
}

/**
 * Deterministically normalize the encounter's FHIR bundle into one human-readable
 * fact line per resource. These lines are the "fhir" source document: Claude may
 * only quote from them, and quotes are verified against this exact text.
 */
export function normalizeFhir(encounter: any): string {
  const lines: string[] = [];
  const rr = encounter.encounter_fhir?.related_resources ?? {};

  for (const c of (rr.Condition ?? []) as FhirResource[]) {
    const status = c.clinicalStatus?.coding?.[0]?.code ?? "unknown-status";
    const verification = c.verificationStatus?.coding?.[0]?.code ?? "unknown";
    lines.push(
      `Condition (${status}, ${verification}): ${codeText(c.code)} — recorded ${dateOnly(c.recordedDate ?? c.onsetDateTime)}`
    );
  }
  for (const m of (rr.MedicationRequest ?? []) as FhirResource[]) {
    const dosage = m.dosageInstruction?.[0]?.text;
    lines.push(
      `MedicationRequest (${m.status}): ${codeText(m.medicationCodeableConcept)}${dosage ? ` — ${dosage}` : ""} — authored ${dateOnly(m.authoredOn)}`
    );
  }
  for (const o of (rr.Observation ?? []) as FhirResource[]) {
    let value = "";
    if (o.valueQuantity) {
      value = ` = ${o.valueQuantity.value} ${o.valueQuantity.unit ?? ""}`.trimEnd();
    } else if (o.valueCodeableConcept) {
      value = ` = ${codeText(o.valueCodeableConcept)}`;
    } else if (o.component?.length) {
      value =
        " = " +
        o.component
          .map(
            (comp: any) =>
              `${codeText(comp.code)}: ${comp.valueQuantity?.value ?? "?"} ${comp.valueQuantity?.unit ?? ""}`.trimEnd()
          )
          .join("; ");
    }
    lines.push(`Observation: ${codeText(o.code)}${value} — ${dateOnly(o.effectiveDateTime)}`);
  }
  for (const p of (rr.Procedure ?? []) as FhirResource[]) {
    lines.push(
      `Procedure (${p.status}): ${codeText(p.code)} — ${dateOnly(p.performedPeriod?.start)}`
    );
  }
  for (const d of (rr.DiagnosticReport ?? []) as FhirResource[]) {
    lines.push(`DiagnosticReport: ${codeText(d.code)} — ${dateOnly(d.effectiveDateTime)}`);
  }
  for (const i of (rr.Immunization ?? []) as FhirResource[]) {
    lines.push(`Immunization (${i.status}): ${codeText(i.vaccineCode)} — ${dateOnly(i.occurrenceDateTime)}`);
  }

  const longitudinal: string[] = encounter.patient_context?.longitudinal_summary?.condition_labels ?? [];
  for (const label of longitudinal) {
    lines.push(`Chart background — longitudinal condition: ${label}`);
  }

  return lines.join("\n");
}

export type LoadedEncounter = {
  encounterId: string;
  patientName: string;
  encounterDate: string;
  visitTitle: string;
  sources: Omit<SourceDocs, "patient_followup">;
};

export function loadEncounter(): LoadedEncounter {
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "encounter.json"), "utf-8");
  const encounter = JSON.parse(raw);
  const patient = encounter.patient_context?.patient;
  const name = patient?.name?.[0];
  return {
    encounterId: encounter.id,
    patientName: name ? `${name.given?.join(" ")} ${name.family}` : "Unknown patient",
    encounterDate: (encounter.metadata?.date ?? "").slice(0, 10),
    visitTitle: encounter.metadata?.visit_title ?? "",
    sources: {
      transcript: encounter.transcript as string,
      clinical_note: encounter.note as string,
      fhir: normalizeFhir(encounter),
    },
  };
}

export function loadPolicy(): PayerPolicy {
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "payer-policy.json"), "utf-8");
  return JSON.parse(raw) as PayerPolicy;
}
