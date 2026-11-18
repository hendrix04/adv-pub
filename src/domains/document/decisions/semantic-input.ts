import { readFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { z } from "zod";
import { readJson } from "../discovery/artifacts.js";
import type { DecisionsRequest } from "@openrouter/sdk/models";
import { decodeCapturedSource, assertOutboundSourceMatches, type CapturedSource } from "../discovery/source.js";
import { authorizedDiscoverySources, isAuthorizedDiscoverySource } from "../source-policy.js";
import { jevModel, jevProvider, classificationOptions, classificationQuestionVersion, sha256, type Candidate } from "./contracts.js";

export async function loadRetainedSource(directory: string) {
  const discovery = resolve(directory);
  const [bytes, sourceManifest] = await Promise.all([readFile(join(discovery, "source.md")), readJson(join(discovery, "source-manifest.json"))]);
  const captured = decodeCapturedSource(bytes);
  const original = z.object({ source_path: z.string(), sha256: z.string(), byte_length: z.number().int().nonnegative() }).parse(sourceManifest);
  if (!isAuthorizedDiscoverySource(original.source_path)) {
    const currentSource = authorizedDiscoverySources().find((path) => basename(path) === basename(original.source_path));
    if (!currentSource) throw new Error("Source is outside the nine-document allowlist");
    const authoritative = decodeCapturedSource(await readFile(currentSource));
    if (original.sha256 !== authoritative.sha256 || original.byte_length !== authoritative.byteLength) {
      throw new Error("Retained source identity does not match the current authorized document");
    }
  }
  if (original.sha256 !== captured.sha256 || original.byte_length !== captured.byteLength) throw new Error("Discovery source manifest does not match its complete source");
  return { discovery, bytes, captured, original };
}

export async function loadDiscoveryCandidates(directory: string) {
  const { discovery, bytes, captured } = await loadRetainedSource(directory);
  const proposalText = await readFile(join(discovery, "decoded-proposals.json"), "utf8");
  const names = z
    .object({ entities: z.array(z.string().min(1)) })
    .strict()
    .parse(JSON.parse(proposalText)).entities;
  const candidatesHash = sha256(proposalText);
  const candidates = sourceCandidates(names, captured, sha256(`${discovery}\n${candidatesHash}`));
  return { discovery, bytes, proposalText, captured, candidatesHash, candidates };
}

/** Extract the seven locked entity definitions from retained rule text. */
function extractRuleDefinitions(text: string, expectedTypes: readonly string[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\| `([^`]+)` \| (.+) \|$/.exec(line);
    if (match) criteria[match[1]!] = match[2]!;
  }
  if (expectedTypes.some((name) => !criteria[name]) || Object.keys(criteria).length !== expectedTypes.length) {
    throw new Error("Locked ontology must contain exactly the seven approved types");
  }
  return criteria;
}

export async function loadClassificationCriteria(): Promise<{
  criteria: Record<string, string>;
  governingRules: string;
  sha256: string;
}> {
  const specification = await readFile(resolve("Resources/specification.md"), "utf8");
  const ontology = specification.split("### ENT-001 Locked entity definitions\n")[1]?.split("### ENT-002")[0];
  const capture = specification.split("### CAP-001 Broad capture and generic-content boundary\n")[1]?.split("### CAP-002")[0];
  const authority = specification.split("### SRC-002 Supplied content is authoritative\n")[1]?.split("### SRC-003")[0];
  if (!ontology || !capture || !authority) throw new Error("Locked ontology/capture/source-authority sections are missing");
  const governingRules = `${authority.trim()}\n\n${capture.trim()}\n\n${ontology.trim()}`;
  return classificationCriteriaFromRules(governingRules);
}

export function classificationCriteriaFromRules(governingRules: string): Awaited<ReturnType<typeof loadClassificationCriteria>> {
  const criteria = extractRuleDefinitions(governingRules, classificationOptions.slice(0, -1));
  criteria.not_an_entity =
    "The candidate does not identify a specific campaign referent meeting any of the seven definitions in this complete source. Generic categories, labels, background rules, or unsupported names are not automatically entities.";
  return { criteria, governingRules, sha256: sha256(JSON.stringify({ criteria, governingRules })) };
}

export function sourceCandidates(names: string[], source: CapturedSource, discoveryHash: string): Candidate[] {
  return names.map((name, index) => {
    const needle = Buffer.from(name, "utf8");
    const occurrences: Candidate["occurrences"] = [];
    if (needle.length) {
      for (let offset = source.bytes.indexOf(needle); offset >= 0; offset = source.bytes.indexOf(needle, offset + 1)) {
        occurrences.push({ start_byte: offset, end_byte: offset + needle.length });
      }
    }
    return {
      candidate_id: `candidate-${discoveryHash.slice(0, 16)}-${String(index).padStart(4, "0")}`,
      index,
      name,
      occurrences,
      findings: occurrences.length ? [] : ["No literal occurrence in the complete source; classification is a proposal, not verified admission."],
    };
  });
}

export function buildClassificationRequest(source: CapturedSource, candidates: Candidate[], ontology: Awaited<ReturnType<typeof loadClassificationCriteria>>): DecisionsRequest {
  return {
    model: jevModel,
    provider: { only: [jevProvider], allowFallbacks: false },
    state: {
      complete_source: source.text,
      source_sha256: source.sha256,
      source_byte_length: source.byteLength,
      governing_rules: ontology.governingRules,
      candidates,
    },
    questions: Object.fromEntries(
      candidates.map((candidate) => [
        candidate.candidate_id,
        {
          type: "choice" as const,
          criteria: ontology.criteria,
          instructions: {
            question_version: classificationQuestionVersion,
            candidate_id: candidate.candidate_id,
            candidate_name: candidate.name,
            task: "Classify this document-local referent using exactly one defined entity type or not_an_entity. Where members are present, they are provisionally source-linked names of this referent; consider their complete-source contexts together. Original member names and occurrences are retained. Use complete table/list/quotation framing and only governing rules. Return the entity type only, not optional attributes. Do not use external lore, invent omitted names, or perform additional identity merges. If the supplied group appears to combine different referents, reflect uncertainty. DM-authored source statements remain authoritative; source-expressed uncertainty is not itself a reason for rejection.",
          },
        },
      ]),
    ),
  };
}

export function assertSemanticSource(request: DecisionsRequest, retainedBytes: Buffer): void {
  const source = decodeCapturedSource(retainedBytes);
  const state = request.state as Record<string, unknown>;
  if (typeof state.complete_source !== "string" || state.source_sha256 !== source.sha256 || state.source_byte_length !== source.byteLength) {
    throw new Error("Semantic source manifest differs from retained source");
  }
  assertOutboundSourceMatches(state.complete_source, source, retainedBytes);
}
