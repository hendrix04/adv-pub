import { z } from "zod";

export type EvidenceProposal = {
  key: string;
  quote: string;
  before: string;
  after: string;
};

export type EvidenceFinding = {
  key: string;
  status: "verified" | "missing" | "ambiguous" | "invalid" | "anchor_mismatch";
  occurrence_count: number;
  start_byte?: number;
  end_byte?: number;
  message: string;
};

function occurrences(source: string, quote: string): number[] {
  const positions: number[] = [];
  if (quote.length === 0) return positions;
  for (let from = 0; ; ) {
    const position = source.indexOf(quote, from);
    if (position < 0) return positions;
    positions.push(position);
    from = position + 1;
  }
}

export function inspectEvidence(source: string, proposals: EvidenceProposal[]): EvidenceFinding[] {
  return proposals.map(({ key, quote, before, after }) => {
    if (!quote) {
      return { key, status: "invalid", occurrence_count: 0, message: "Evidence quote is empty." };
    }

    const allMatches = occurrences(source, quote);
    if (allMatches.length === 0) {
      return { key, status: "missing", occurrence_count: 0, message: "Quote does not occur in the complete source." };
    }

    const anchored = allMatches.filter((position) => source.slice(0, position).endsWith(before) && source.slice(position + quote.length).startsWith(after));
    if (anchored.length === 0) {
      const hasAnchors = Boolean(before || after);
      return {
        key,
        status: allMatches.length === 1 ? (hasAnchors ? "anchor_mismatch" : "verified") : "ambiguous",
        occurrence_count: allMatches.length,
        ...(allMatches.length === 1 ? byteSpan(source, allMatches[0]!, quote) : {}),
        message:
          allMatches.length === 1
            ? hasAnchors
              ? "The quote is unique, but supplied adjacent context does not match."
              : "Unique exact quote found; no anchors were needed."
            : "No occurrence is uniquely selected by the supplied context.",
      };
    }
    if (anchored.length > 1) {
      return {
        key,
        status: "ambiguous",
        occurrence_count: anchored.length,
        message: "More than one occurrence matches the supplied context.",
      };
    }

    return {
      key,
      status: "verified",
      occurrence_count: 1,
      ...byteSpan(source, anchored[0]!, quote),
      message: "Exact quote and adjacent context uniquely match the source.",
    };
  });
}

function byteSpan(source: string, position: number, quote: string): Pick<EvidenceFinding, "start_byte" | "end_byte"> {
  const start_byte = Buffer.byteLength(source.slice(0, position), "utf8");
  return { start_byte, end_byte: start_byte + Buffer.byteLength(quote, "utf8") };
}

type ValidationOutput = {
  schema: Array<{ path: string; message: string }>;
  evidence: EvidenceFinding[];
  sourceKeys: Array<{ key: string; message: string }>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function gatherEvidence(payload: unknown): EvidenceProposal[] {
  const proposals: EvidenceProposal[] = [];
  const root = record(payload);
  if (!root) return proposals;

  const collections = ["entities", "assertions", "relationship_proposals", "explicit_dates", "useful_passages"];
  for (const name of collections) {
    const values = Array.isArray(root[name]) ? (root[name] as unknown[]) : [];
    values.forEach((item, index) => {
      const object = record(item);
      const evidence = object && (name === "entities" ? object.mentions : object.evidence);
      if (!Array.isArray(evidence)) return;
      evidence.forEach((raw, evidenceIndex) => {
        const itemRecord = record(raw);
        if (!itemRecord) return;
        const evidenceField = name === "entities" ? "mentions" : "evidence";
        proposals.push({
          key: `${name}[${index}].${evidenceField}[${evidenceIndex}]:${String(itemRecord.evidence_key ?? "")}`,
          quote: typeof itemRecord.quote === "string" ? itemRecord.quote : "",
          before: typeof itemRecord.before === "string" ? itemRecord.before : "",
          after: typeof itemRecord.after === "string" ? itemRecord.after : "",
        });
      });
    });
  }
  return proposals;
}

function inspectKeys(payload: unknown): ValidationOutput["sourceKeys"] {
  const root = record(payload);
  if (!root) return [];
  const findings: ValidationOutput["sourceKeys"] = [];
  const collections = ["entities", "assertions", "relationship_proposals", "explicit_dates", "useful_passages"];
  const known = new Set<string>();
  const keyFields: Record<string, string> = {
    entities: "candidate_key",
    assertions: "assertion_key",
    relationship_proposals: "relationship_key",
    explicit_dates: "date_key",
    useful_passages: "passage_key",
  };
  for (const [collection, keyField] of Object.entries(keyFields)) {
    const items = Array.isArray(root[collection]) ? (root[collection] as unknown[]) : [];
    items.forEach((item, index) => {
      const key = record(item)?.[keyField];
      if (typeof key !== "string" || key.length === 0) return;
      if (known.has(key)) findings.push({ key, message: `Duplicate response-local key at ${collection}[${index}].` });
      known.add(key);
    });
  }
  const candidateKeys = new Set(
    (Array.isArray(root.entities) ? (root.entities as unknown[]) : []).map((item) => record(item)?.candidate_key).filter((key): key is string => typeof key === "string"),
  );
  const candidatesByKey = new Map<string, Record<string, unknown>>();
  for (const item of Array.isArray(root.entities) ? (root.entities as unknown[]) : []) {
    const entity = record(item);
    if (entity && typeof entity.candidate_key === "string") candidatesByKey.set(entity.candidate_key, entity);
  }
  const endpointTypes: Record<string, { subject: string[]; object: string[] }> = {
    located_in: { subject: ["Creature", "Location", "Item", "Organization"], object: ["Location"] },
    headquartered_in: { subject: ["Organization"], object: ["Location"] },
    member_of: { subject: ["Creature", "Organization", "Location"], object: ["Organization"] },
    leads: { subject: ["Creature"], object: ["Organization", "Event"] },
    serves: { subject: ["Creature", "Organization"], object: ["Creature", "Organization"] },
    sponsors: { subject: ["Creature", "Organization"], object: ["Organization"] },
    allied_with: { subject: ["Organization", "Creature"], object: ["Organization", "Creature"] },
    hostile_to: { subject: ["Organization", "Creature"], object: ["Organization", "Creature"] },
    family_of: { subject: ["Creature"], object: ["Creature"] },
    worships: { subject: ["Creature", "Organization"], object: ["Creature", "Concept"] },
    possesses: { subject: ["Creature", "Organization", "Location"], object: ["Item"] },
    created: { subject: ["Creature", "Organization"], object: ["Item", "Concept", "Location"] },
    participated_in: { subject: ["Creature", "Organization"], object: ["Event"] },
    occurred_at: { subject: ["Event"], object: ["Location"] },
    concerns: { subject: ["Quest"], object: ["Creature", "Location", "Item", "Organization", "Concept"] },
    quest_giver_for: { subject: ["Creature", "Organization"], object: ["Quest"] },
    resulted_in: { subject: ["Event", "Quest"], object: ["Event", "Quest"] },
    associated_with: { subject: ["*"], object: ["*"] },
  };
  const dateKeys = new Set(
    (Array.isArray(root.explicit_dates) ? (root.explicit_dates as unknown[]) : []).map((date) => record(date)?.date_key).filter((key): key is string => typeof key === "string"),
  );
  for (const collection of ["assertions", "relationship_proposals"]) {
    const items = Array.isArray(root[collection]) ? (root[collection] as unknown[]) : [];
    items.forEach((item, index) => {
      const object = record(item);
      if (!object) return;
      for (const field of ["subject_candidate_key", "object_candidate_key"]) {
        const key = object[field];
        if (typeof key === "string" && key !== "" && !candidateKeys.has(key)) {
          findings.push({ key, message: `${collection}[${index}] refers to unknown candidate key ${field}.` });
        }
      }
      if (collection === "relationship_proposals") {
        for (const [field, nameField] of [
          ["subject_candidate_key", "subject_name"],
          ["object_candidate_key", "object_name"],
        ]) {
          const key = object[field];
          const name = object[nameField];
          const target = typeof key === "string" ? candidatesByKey.get(key) : undefined;
          if (!target) continue;
          const aliases = Array.isArray(target.aliases) ? target.aliases.filter((alias): alias is string => typeof alias === "string") : [];
          if (typeof name === "string" && name !== "" && name !== target.name && !aliases.includes(name)) {
            findings.push({
              key: String(key),
              message: `${collection}[${index}] ${nameField} does not match the referenced candidate name or source alias.`,
            });
          }
          const predicate = typeof object.predicate === "string" ? object.predicate : "";
          const endpoint = endpointTypes[predicate];
          if (
            endpoint &&
            !endpoint[field === "subject_candidate_key" ? "subject" : "object"].includes("*") &&
            !endpoint[field === "subject_candidate_key" ? "subject" : "object"].includes(String(target.entity_type))
          ) {
            findings.push({
              key: String(key),
              message: `${collection}[${index}] predicate ${predicate} has incompatible endpoint type ${String(target.entity_type)} at ${field}.`,
            });
          }
        }
      }
      if (collection === "assertions") {
        for (const [field, nameField] of [
          ["subject_candidate_key", "subject_name"],
          ["object_candidate_key", "object_text"],
        ]) {
          const key = object[field];
          const name = object[nameField];
          const target = typeof key === "string" ? candidatesByKey.get(key) : undefined;
          if (!target || typeof name !== "string" || name === "") continue;
          const aliases = Array.isArray(target.aliases) ? target.aliases.filter((alias): alias is string => typeof alias === "string") : [];
          if (name !== target.name && !aliases.includes(name)) {
            findings.push({
              key: String(key),
              message: `${collection}[${index}] ${nameField} does not match the referenced candidate name or source alias.`,
            });
          }
        }
        const dateKey = object.explicit_date_key;
        if (typeof dateKey === "string" && dateKey !== "" && !dateKeys.has(dateKey)) {
          findings.push({ key: dateKey, message: `${collection}[${index}] refers to unknown explicit_date_key.` });
        }
      }
    });
  }
  const evidenceKeys = new Set<string>();
  for (const collection of collections) {
    const items = Array.isArray(root[collection]) ? (root[collection] as unknown[]) : [];
    items.forEach((item, index) => {
      const object = record(item);
      const evidenceField = collection === "entities" ? "mentions" : "evidence";
      const evidence = object && Array.isArray(object[evidenceField]) ? (object[evidenceField] as unknown[]) : [];
      evidence.forEach((raw, evidenceIndex) => {
        const key = record(raw)?.evidence_key;
        if (typeof key !== "string" || key === "") return;
        if (evidenceKeys.has(key))
          findings.push({
            key,
            message: `Duplicate evidence key at ${collection}[${index}].${evidenceField}[${evidenceIndex}].`,
          });
        evidenceKeys.add(key);
      });
    });
  }
  return findings;
}

export function decodeProposalContent(content: unknown): { decoded?: unknown; finding?: string } {
  if (typeof content !== "string") return { finding: "The response content is not a text JSON value." };
  try {
    return { decoded: JSON.parse(content) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { finding: `Invalid JSON: ${message}` };
  }
}

export function validateProposals(payload: unknown, schema: unknown, source: string): ValidationOutput {
  const parsed = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0], { defaultTarget: "draft-2020-12" }).safeParse(payload);
  return {
    schema: parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.length ? `/${issue.path.map(String).join("/")}` : "/",
          message: issue.message,
        })),
    evidence: inspectEvidence(source, gatherEvidence(payload)),
    sourceKeys: inspectKeys(payload),
  };
}

export function renderCandidateView(payload: unknown, findings?: ValidationOutput): string {
  const root = record(payload);
  if (!root) return `# Candidate proposals\n\nDecoded payload is not an object. See the decoded JSON and findings files.\n`;
  const lines = ["# Entity name candidates", "", "Unaccepted candidate names from one complete-source discovery response.", ""];
  const entities = Array.isArray(root.entities) ? (root.entities as unknown[]) : [];
  lines.push(`## Entities (${entities.length})`, "");
  for (const value of entities) {
    if (typeof value === "string") {
      lines.push(`- ${value}`);
      continue;
    }
    const entity = record(value);
    if (!entity) continue;
    const name = String(entity.name ?? "(unnamed proposal)");
    const hasDetails = Object.hasOwn(entity, "candidate_key") || Object.hasOwn(entity, "aliases") || Object.hasOwn(entity, "notes") || Object.hasOwn(entity, "mentions");
    lines.push(`- ${name}`);
    if (!hasDetails) continue;
    lines.push("");
    if (entity.candidate_key) lines.push(`  - Local key: ${String(entity.candidate_key)}`);
    if (Array.isArray(entity.aliases) && entity.aliases.length) lines.push(`- Aliases: ${entity.aliases.map(String).join(", ")}`);
    if (entity.notes) lines.push(`- Source-specific note: ${String(entity.notes)}`);
    const mentions = Array.isArray(entity.mentions) ? (entity.mentions as unknown[]) : [];
    for (const mention of mentions) {
      const ev = record(mention);
      if (ev) lines.push(`- Mention: “${String(ev.quote ?? "")}” [${String(ev.evidence_key ?? "")}]`);
    }
    lines.push("");
  }
  if (Object.hasOwn(root, "assertions"))
    appendSection(
      lines,
      "Assertions",
      root.assertions,
      "assertion_key",
      (item) =>
        `${String(item.subject_name ?? item.subject_candidate_key ?? "")} — ${String(item.predicate_or_attribute ?? "")} ${String(item.object_text ?? item.object_candidate_key ?? "")} (${String(item.polarity ?? "")})${item.qualification ? `; qualification: ${String(item.qualification)}` : ""}${item.explicit_date_key ? `; date key: ${String(item.explicit_date_key)}` : ""}${item.attribution ? `; attributed to ${String(item.attribution)}` : ""}`,
    );
  if (Object.hasOwn(root, "relationship_proposals"))
    appendSection(
      lines,
      "Relationship proposals",
      root.relationship_proposals,
      "relationship_key",
      (item) =>
        `${String(item.subject_name ?? item.subject_candidate_key ?? "")} — ${String(item.predicate || "unspecified relation")} → ${String(item.object_name ?? item.object_candidate_key ?? "")} (${String(item.polarity ?? "")})${item.proposed_predicate ? `; source relation: ${String(item.proposed_predicate)}` : ""}${item.qualifier ? `; qualifier: ${String(item.qualifier)}` : ""}${item.attribution ? `; attributed to ${String(item.attribution)}` : ""}`,
    );
  if (Object.hasOwn(root, "explicit_dates"))
    appendSection(
      lines,
      "Explicit dates and periods",
      root.explicit_dates,
      "date_key",
      (item) =>
        `${String(item.source_wording ?? "")} — ${String(item.describes ?? "")}${item.normalized_value ? ` (normalized: ${String(item.normalized_value)})` : ""}${item.attribution ? `; attributed to ${String(item.attribution)}` : ""}`,
    );
  if (Object.hasOwn(root, "useful_passages")) appendSection(lines, "Useful passages", root.useful_passages, "passage_key", (item) => String(item.why_useful ?? ""));
  if (findings) {
    const evidence = findings.evidence.filter((item) => item.status !== "verified");
    if (evidence.length) {
      lines.push("## Evidence pointers needing review", "");
      for (const finding of evidence) lines.push(`- ${finding.key}: ${finding.status} — ${finding.message}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function appendSection(lines: string[], title: string, value: unknown, keyName: string, render: (item: Record<string, unknown>) => string): void {
  const items = Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  lines.push(`## ${title} (${items.length})`, "");
  for (const item of items) {
    lines.push(`- [${String(item[keyName] ?? "")}]: ${render(item)}`);
    const evidence = Array.isArray(item.evidence) ? (item.evidence as unknown[]) : [];
    for (const raw of evidence) {
      const ev = record(raw);
      if (ev) lines.push(`  - Evidence: “${String(ev.quote ?? "")}” [${String(ev.evidence_key ?? "")}]`);
    }
  }
  lines.push("");
}
