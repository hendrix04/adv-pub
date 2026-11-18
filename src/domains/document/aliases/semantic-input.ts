import type { DecisionsRequest } from "@openrouter/sdk/models";
import type { CapturedSource } from "../discovery/source.js";
import { sourceComponent } from "../discovery/source.js";
import { jevModel, jevProvider, type Candidate, type AliasPair } from "../decisions/contracts.js";
import * as catalogQuestions from "../decisions/questions.js";

export const linkThreshold = 0.9;
export const aliasInstructions =
  "Determine whether the two supplied names identify the SAME specific referent in this complete document. Include source-supported acronyms, short names, epithets, and alternate spellings. A source need not explicitly spell out an acronym expansion if the complete document's referent and discourse context support it. Structural name clues are retrieval hints, not proof. Shared words, resemblance, co-occurrence, or a theoretical acronym expansion alone do not establish identity. Generic labels, title substrings, related beings, a group and one member, a place and its occupant, a religion and its organization, and appearances are not automatically the same referent. Inspect all occurrences and full source framing; if a name has incompatible referents or the identity link is not sufficiently supported, choose unclear. Do not use classifications, external lore, or campaign-adoption judgments. The answer is a document-local identity proposal, not a canonical merge.";

export function structuralNameClues(left: string, right: string): string[] {
  const clues: string[] = [];
  const ignoredWords = new Set(["a", "an", "the", "of", "and", "in", "for", "to"]);
  for (const [short, long] of [
    [left, right],
    [right, left],
  ]) {
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(short)) continue;
    const words = long.match(/[\p{L}\p{N}]+/gu) ?? [];
    const initials = words
      .filter((word) => !ignoredWords.has(word.toLowerCase()))
      .map((word) => word[0])
      .join("")
      .toUpperCase();
    if (words.length > 1 && short === initials)
      clues.push(`${JSON.stringify(short)} matches the non-function-word initials of ${JSON.stringify(long)}. Verify the referent using source context.`);
  }
  return clues;
}

export type AcronymOccurrence = ReturnType<typeof sourceComponent>;
export type AcronymPairClue = {
  acronym: AcronymOccurrence;
  full_name: string;
  full_name_candidate_id: string;
  acronym_candidate_id: string;
  matching_rules: Array<"written_expansion" | "all_words_initials" | "without_function_words_initials">;
  full_name_evidence: AcronymOccurrence[];
  written_expansion_evidence: AcronymOccurrence[];
  initials: Array<{
    rule: "all_words_initials" | "without_function_words_initials";
    words: string[];
    initials: string;
  }>;
};

export type AcronymScan = {
  disposition_version: "source-backed-missing-names-v3";
  acronyms: AcronymOccurrence[];
  pair_clues: AcronymPairClue[];
  unresolved: Array<{
    acronym: AcronymOccurrence;
    possible_written_expansions: Array<{ name: string; source_span: AcronymOccurrence }>;
    possible_initials_expansions?: Array<Pick<AcronymPairClue, "full_name" | "full_name_candidate_id" | "matching_rules" | "full_name_evidence" | "initials">>;
  }>;
  discovery_findings: Array<{
    candidate_id: string | null;
    name: string;
    source_span: AcronymOccurrence | null;
    related_span?: AcronymOccurrence;
    reason: string;
  }>;
};

const functionWords = new Set(["a", "an", "the", "of", "and", "in", "for", "to"]);

function codePointWords(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function initials(words: string[]): string {
  return words
    .map((word) => [...word][0] ?? "")
    .join("")
    .toLocaleUpperCase("en-US");
}

function acronymKey(value: string): string {
  return value.replaceAll(".", "").toLocaleUpperCase("en-US");
}

function isAcronymSpelling(value: string): boolean {
  if (!/^[\p{Lu}\p{N}]+(?:\.[\p{Lu}\p{N}]+)*\.?$/u.test(value)) return false;
  return [...value.replaceAll(".", "")].filter((character) => /\p{L}/u.test(character)).length >= 2;
}

function byteToTextOffset(source: CapturedSource, offset: number): number {
  return source.bytes.subarray(0, offset).toString("utf8").length;
}

function sourceOccurrences(source: CapturedSource, candidate: Candidate): AcronymOccurrence[] {
  return candidate.occurrences.map(({ start_byte, end_byte }) => {
    const start = byteToTextOffset(source, start_byte);
    const end = byteToTextOffset(source, end_byte);
    const component = sourceComponent(source, start, end);
    if (component.text !== candidate.name || component.start_byte !== start_byte || component.end_byte !== end_byte) {
      throw new Error(`Candidate source evidence changed: ${candidate.candidate_id}`);
    }
    return component;
  });
}

function writtenExpansionEvidence(source: CapturedSource, fullName: Candidate, acronym: AcronymOccurrence, occurrences: AcronymOccurrence[]): AcronymOccurrence[] {
  const evidence: AcronymOccurrence[] = [];
  const acronymPattern = acronym.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fullNamePattern = fullName.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const afterAcronym = new RegExp(`^\\s*\\(\\s*${fullNamePattern}\\s*\\)`, "iu");
  const afterFullName = new RegExp(`^\\s*\\(\\s*(${acronymPattern})\\s*\\)`, "iu");
  const acronymStart = byteToTextOffset(source, acronym.start_byte);
  const acronymEnd = byteToTextOffset(source, acronym.end_byte);
  const after = source.text.slice(acronymEnd);
  const forward = afterAcronym.exec(after);
  if (forward) evidence.push(sourceComponent(source, acronymStart, acronymEnd + forward[0].length));
  for (const span of occurrences) {
    const start = byteToTextOffset(source, span.start_byte);
    const end = byteToTextOffset(source, span.end_byte);
    const match = afterFullName.exec(source.text.slice(end));
    if (!match) continue;
    const matchedAcronym = match[1]!;
    const matchedAcronymStart = end + match[0].indexOf(matchedAcronym);
    const matchedAcronymEnd = matchedAcronymStart + matchedAcronym.length;
    if (acronymKey(matchedAcronym) === acronymKey(acronym.text) && matchedAcronymStart === acronymStart && matchedAcronymEnd === acronymEnd)
      evidence.push(sourceComponent(source, start, end + match[0].length));
  }
  return evidence;
}

function matchingInitials(words: string[], key: string): AcronymPairClue["initials"] {
  if (words.length < 2) return [];
  const matched: AcronymPairClue["initials"] = [];
  for (const [rule, selected] of [
    ["all_words_initials", words],
    ["without_function_words_initials", words.filter((word) => !functionWords.has(word.toLocaleLowerCase("en-US")))],
  ] as const) {
    const value = initials(selected);
    if (value === key) matched.push({ rule, words: selected, initials: value });
  }
  return matched;
}

function isWrittenExpansionPhrase(value: string): boolean {
  const words = codePointWords(value.trim());
  return (
    words.length >= 2 &&
    words.filter((word) => /^\p{Lu}/u.test(word)).length >= 2 &&
    words.every((word) => /^\p{Lu}/u.test(word) || functionWords.has(word.toLocaleLowerCase("en-US")))
  );
}

function expansionBeforeParenthesis(source: CapturedSource, parenStart: number): AcronymOccurrence | null {
  const lower = Math.max(0, parenStart - 320);
  const prefix = source.text.slice(lower, parenStart);
  const boundaries = [...prefix.matchAll(/[\r\n.!?;:]/gu)];
  const phraseOffset = boundaries.length ? boundaries.at(-1)!.index! + 1 : 0;
  const words = [...prefix.slice(phraseOffset).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  let firstIndex = words.length - 1;
  let capitalizedCount = 0;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index]![0];
    if (/^\p{Lu}/u.test(word)) {
      capitalizedCount += 1;
      firstIndex = index;
    } else if (functionWords.has(word.toLocaleLowerCase("en-US"))) {
      firstIndex = index;
    } else break;
  }
  if (capitalizedCount < 2 || firstIndex < 0) return null;
  const first = words[firstIndex]!;
  const last = words.at(-1)!;
  const start = lower + phraseOffset + first.index!;
  const end = lower + phraseOffset + last.index! + last[0].length;
  const text = source.text.slice(start, end);
  return isWrittenExpansionPhrase(text) ? sourceComponent(source, start, end) : null;
}

function nearbyWrittenExpansion(source: CapturedSource, acronym: AcronymOccurrence): Array<{ name: string; source_span: AcronymOccurrence }> {
  const start = byteToTextOffset(source, acronym.start_byte);
  const end = byteToTextOffset(source, acronym.end_byte);
  const found = new Map<string, AcronymOccurrence>();
  const after = /^\s*\(\s*([^()\r\n]{2,160}?)\s*\)/u.exec(source.text.slice(end));
  if (after && isWrittenExpansionPhrase(after[1]!)) {
    const offset = source.text.slice(end).indexOf(after[1]!);
    const span = sourceComponent(source, end + offset, end + offset + after[1]!.length);
    found.set(`${span.start_byte}:${span.end_byte}`, span);
  }

  const open = source.text.lastIndexOf("(", start);
  const close = source.text.indexOf(")", end);
  if (open >= 0 && close >= end && close - open <= 180 && acronymKey(source.text.slice(open + 1, close).trim()) === acronymKey(acronym.text)) {
    const expansion = expansionBeforeParenthesis(source, open);
    if (expansion) found.set(`${expansion.start_byte}:${expansion.end_byte}`, expansion);
  }
  return [...found.values()].map((source_span) => ({ name: source_span.text, source_span }));
}

/** Retain full-source acronym evidence without adding or rewriting discovery candidates. */
export function scanAcronymClues(source: CapturedSource, candidates: Candidate[]): AcronymScan {
  const occurrencesByCandidate = new Map(candidates.map((candidate) => [candidate.candidate_id, sourceOccurrences(source, candidate)]));
  const acronymBySpan = new Map<string, AcronymOccurrence>();
  const token = /[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*/gu;
  for (const match of source.text.matchAll(token)) {
    const value = match[0];
    if (/\p{N}/u.test(value)) continue;
    const letters = [...value].filter((character) => /\p{L}/u.test(character));
    if (
      letters.length < 2 ||
      letters.some((character) => character.toLocaleUpperCase("en-US") === character.toLocaleLowerCase("en-US") || character !== character.toLocaleUpperCase("en-US"))
    )
      continue;
    const end = match.index! + value.length + (value.includes(".") && source.text[match.index! + value.length] === "." ? 1 : 0);
    const occurrence = sourceComponent(source, match.index!, end);
    acronymBySpan.set(`${occurrence.start_byte}:${occurrence.end_byte}`, occurrence);
  }

  // Candidate spans are exact source evidence and can include the final dot in a dotted spelling.
  // Add those spans directly so U.C.R. is not mistaken for U.C.R plus sentence punctuation.
  const candidateOccurrences = candidates.flatMap((candidate) =>
    isAcronymSpelling(candidate.name) ? (occurrencesByCandidate.get(candidate.candidate_id) ?? []).map((occurrence) => ({ candidate, occurrence })) : [],
  );
  for (const { occurrence } of candidateOccurrences) {
    for (const [span, tokenOccurrence] of acronymBySpan) {
      if (
        tokenOccurrence.start_byte === occurrence.start_byte &&
        tokenOccurrence.end_byte + 1 === occurrence.end_byte &&
        source.bytes.subarray(tokenOccurrence.end_byte, occurrence.end_byte).toString("utf8") === "."
      )
        acronymBySpan.delete(span);
    }
  }
  for (const { occurrence } of candidateOccurrences) acronymBySpan.set(`${occurrence.start_byte}:${occurrence.end_byte}`, occurrence);
  const acronyms = [...acronymBySpan.values()].sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);

  const candidateAcronyms = candidates.flatMap((candidate) => {
    const candidateKey = acronymKey(candidate.name);
    if (!isAcronymSpelling(candidate.name)) return [];
    const occurrences = occurrencesByCandidate.get(candidate.candidate_id) ?? [];
    return occurrences.length && acronyms.some((entry) => acronymKey(entry.text) === candidateKey) ? [{ candidate, candidateKey, occurrences }] : [];
  });
  const pair_clues: AcronymPairClue[] = [];
  const unresolved: AcronymScan["unresolved"] = [];
  for (const acronym of acronyms) {
    const key = acronymKey(acronym.text);
    const acronymCandidates = candidateAcronyms.filter(
      (entry) => entry.candidateKey === key && entry.occurrences.some((occurrence) => occurrence.start_byte === acronym.start_byte && occurrence.end_byte === acronym.end_byte),
    );
    if (!acronymCandidates.length) {
      const possibleInitials = candidates.flatMap((candidate) => {
        const evidence = occurrencesByCandidate.get(candidate.candidate_id) ?? [];
        const matched = matchingInitials(codePointWords(candidate.name), key);
        return evidence.length && matched.length
          ? [
              {
                full_name: candidate.name,
                full_name_candidate_id: candidate.candidate_id,
                matching_rules: matched.map((entry) => entry.rule),
                full_name_evidence: evidence,
                initials: matched,
              },
            ]
          : [];
      });
      unresolved.push({
        acronym,
        possible_written_expansions: nearbyWrittenExpansion(source, acronym),
        ...(possibleInitials.length ? { possible_initials_expansions: possibleInitials } : {}),
      });
      continue;
    }
    const expansions = new Set<string>();
    for (const acronymCandidate of acronymCandidates) {
      for (const fullName of candidates) {
        const fullNameOccurrences = occurrencesByCandidate.get(fullName.candidate_id) ?? [];
        if (fullName.candidate_id === acronymCandidate.candidate.candidate_id || !fullNameOccurrences.length) continue;
        const words = codePointWords(fullName.name);
        if (words.length < 2) continue;
        const written = writtenExpansionEvidence(source, fullName, acronym, fullNameOccurrences);
        const matchedInitials = matchingInitials(words, key);
        const matching_rules: AcronymPairClue["matching_rules"] = matchedInitials.map((entry) => entry.rule);
        if (written.length) matching_rules.push("written_expansion");
        if (!matching_rules.length) continue;
        expansions.add(fullName.candidate_id);
        pair_clues.push({
          acronym,
          full_name: fullName.name,
          full_name_candidate_id: fullName.candidate_id,
          acronym_candidate_id: acronymCandidate.candidate.candidate_id,
          matching_rules,
          full_name_evidence: fullNameOccurrences,
          written_expansion_evidence: written,
          initials: matchedInitials,
        });
      }
    }
    if (!expansions.size) unresolved.push({ acronym, possible_written_expansions: nearbyWrittenExpansion(source, acronym) });
  }
  const discovery_findings: AcronymScan["discovery_findings"] = candidates
    .filter((candidate) => !candidate.occurrences.length)
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      source_span: null,
      reason: "Discovery name has no exact source occurrence; retain it for review and rerun compatible discovery before qualification.",
    }));
  const findingKeys = new Set<string>();
  for (const entry of unresolved) {
    const key = `${entry.acronym.start_byte}:${entry.acronym.end_byte}`;
    const coveredByCandidateName = [...occurrencesByCandidate.values()]
      .flat()
      .some((occurrence) => occurrence.start_byte <= entry.acronym.start_byte && occurrence.end_byte >= entry.acronym.end_byte);
    const expansionEvidence = entry.possible_written_expansions.length > 0;
    if (
      !candidateOccurrences.some(({ occurrence }) => occurrence.start_byte === entry.acronym.start_byte && occurrence.end_byte === entry.acronym.end_byte) &&
      !coveredByCandidateName &&
      expansionEvidence &&
      !findingKeys.has(key)
    ) {
      findingKeys.add(key);
      discovery_findings.push({
        candidate_id: null,
        name: entry.acronym.text,
        source_span: entry.acronym,
        reason: "Source acronym occurrence has written expansion evidence but is absent from discovery candidates; review and rerun compatible discovery before qualification.",
      });
    }
  }
  const expansionFindingKeys = new Set<string>();
  for (const acronym of acronyms) {
    for (const expansion of nearbyWrittenExpansion(source, acronym)) {
      const key = `${expansion.source_span.start_byte}:${expansion.source_span.end_byte}:${expansion.name}`;
      if (candidates.some((candidate) => candidate.name === expansion.name && candidate.occurrences.length) || expansionFindingKeys.has(key)) continue;
      expansionFindingKeys.add(key);
      discovery_findings.push({
        candidate_id: null,
        name: expansion.name,
        source_span: expansion.source_span,
        related_span: acronym,
        reason: `Written acronym expansion ${JSON.stringify(expansion.name)} is absent from source-backed discovery candidates; rerun compatible discovery before qualification.`,
      });
    }
  }
  return {
    disposition_version: "source-backed-missing-names-v3",
    acronyms,
    pair_clues,
    unresolved,
    discovery_findings,
  };
}

export function allCandidatePairs(candidates: Candidate[]): AliasPair[] {
  const pairs: AliasPair[] = [];
  candidates.forEach((left, index) => {
    for (const right of candidates.slice(index + 1))
      pairs.push({
        pair_id: `pair-${String(left.index).padStart(4, "0")}-${String(right.index).padStart(4, "0")}`,
        left_id: left.candidate_id,
        right_id: right.candidate_id,
      });
  });
  return pairs;
}

export function buildCatalogAliasQuestions(source: CapturedSource, candidates: Candidate[]) {
  const scan = scanAcronymClues(source, candidates);
  const occurrencesByCandidate = new Map(candidates.map((candidate) => [candidate.candidate_id, sourceOccurrences(source, candidate)]));
  const cluesByPair = new Map<string, AcronymPairClue[]>();
  for (const clue of scan.pair_clues) {
    const pairId = [clue.full_name_candidate_id, clue.acronym_candidate_id].sort().join("/");
    cluesByPair.set(pairId, [...(cluesByPair.get(pairId) ?? []), clue]);
  }
  const pairs = allCandidatePairs(candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const questions = pairs.map((pair) => {
    const clues = cluesByPair.get([pair.left_id, pair.right_id].sort().join("/")) ?? [];
    const clue = clues[0];
    const left = byId.get(pair.left_id)!;
    const right = byId.get(pair.right_id)!;
    const nameA = clue ? byId.get(clue.full_name_candidate_id)! : left;
    const nameB = clue ? byId.get(clue.acronym_candidate_id)! : right;
    const nameClues = {
      candidate_ids: [nameA.candidate_id, nameB.candidate_id],
      source_evidence: [
        {
          candidate_id: nameA.candidate_id,
          name: nameA.name,
          occurrences: occurrencesByCandidate.get(nameA.candidate_id) ?? [],
          findings: nameA.findings,
        },
        {
          candidate_id: nameB.candidate_id,
          name: nameB.name,
          occurrences: occurrencesByCandidate.get(nameB.candidate_id) ?? [],
          findings: nameB.findings,
        },
      ],
      acronym_clues: clues,
      unresolved_acronyms: scan.unresolved.filter((entry) => [nameA.name, nameB.name].some((name) => acronymKey(entry.acronym.text) === acronymKey(name))),
    };
    return clue
      ? catalogQuestions.acronymIdentity({
          id: pair.pair_id,
          target: { name_a: nameA.name, name_b: nameB.name, name_clues: nameClues },
        })
      : catalogQuestions.aliasIdentity({
          id: pair.pair_id,
          target: { name_a: left.name, name_b: right.name, name_clues: nameClues },
        });
  });
  return { pairs, questions, scan };
}

export function buildAliasRequest(source: CapturedSource, candidates: Candidate[], pairs: AliasPair[], governingRules: string): DecisionsRequest {
  const used = new Set(pairs.flatMap((pair) => [pair.left_id, pair.right_id]));
  const byId = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  return {
    model: jevModel,
    provider: { only: [jevProvider], allowFallbacks: false },
    state: {
      complete_source: source.text,
      source_sha256: source.sha256,
      source_byte_length: source.byteLength,
      governing_rules: governingRules,
      alias_instructions: aliasInstructions,
      candidates: candidates.filter((candidate) => used.has(candidate.candidate_id)),
    },
    questions: Object.fromEntries(
      pairs.map((pair) => [
        pair.pair_id,
        {
          type: "choice" as const,
          instructions: {
            left_candidate_id: pair.left_id,
            right_candidate_id: pair.right_id,
            left_name: byId.get(pair.left_id)!.name,
            right_name: byId.get(pair.right_id)!.name,
            structural_name_clues: structuralNameClues(byId.get(pair.left_id)!.name, byId.get(pair.right_id)!.name),
            task: "Apply alias_instructions to these two names using complete_source. Decide identity independently of whether either referent belongs in an entity index.",
          },
          criteria: {
            same_referent: "The source supports both names as names of the same referent.",
            different_referents: "The source supports different referents or distinct kinds of referent.",
            unclear: "The source does not sufficiently settle the identity link, or either name has incompatible referents.",
          },
        },
      ]),
    ),
  };
}
