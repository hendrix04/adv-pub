import assert from "node:assert/strict";
import test from "node:test";
import { allCandidatePairs, buildAliasRequest, buildCatalogAliasQuestions, scanAcronymClues, structuralNameClues } from "./semantic-input.js";
import { buildCatalogReferentGroups, buildReferentGroups } from "./groups.js";
import { decodeCapturedSource } from "../discovery/source.js";
import { sourceCandidates } from "../decisions/semantic-input.js";
import { aliasDecisionSchema, sha256, type Manifest, type AliasDecision } from "../decisions/contracts.js";
import { validateBatchResponse } from "../decisions/validation.js";
import { planDecisionBatches } from "../decisions/request.js";

const source = decodeCapturedSource(Buffer.from("Unified Church of the Realms (UCR), also called the Church. A separate Church of Night exists."));
const candidates = sourceCandidates(["Unified Church of the Realms", "UCR", "Church", "Church of Night"], source, "fixture");
const pairs = allCandidatePairs(candidates);

function link(left: number, right: number): AliasDecision {
  return aliasDecisionSchema.parse({
    ...pairs.find((pair) => pair.left_id === candidates[left]!.candidate_id && pair.right_id === candidates[right]!.candidate_id),
    answer: "same_referent",
    confidence: 0.99,
    option_probabilities: { same_referent: 0.99, different_referents: 0.01, unclear: 0 },
    outcome: "provisional_link",
    question_version: "document-alias-v2",
    raw_response_reference: "/raw",
    source_sha256: source.sha256,
    discovery_directory: "/source",
    left_evidence: candidates[left]!.occurrences,
    right_evidence: candidates[right]!.occurrences,
  });
}

test("alias discovery covers every unordered pair without using a type or spelling filter", () => {
  assert.equal(pairs.length, (4 * 3) / 2);
  assert.equal(new Set(pairs.map((pair) => pair.pair_id)).size, 6);
  assert.ok(pairs.some((pair) => pair.left_id === candidates[1]!.candidate_id && pair.right_id === candidates[3]!.candidate_id));
  const batches = planDecisionBatches(pairs, 32_000, 50, (slice) => buildAliasRequest(source, candidates, slice, "source rules"));
  assert.deepEqual(
    batches.flatMap((batch) => batch.candidate_ids),
    pairs.map((pair) => pair.pair_id),
  );
});

test("acronym clues are explicit source-name computations, without automatic identity links", () => {
  assert.equal(structuralNameClues("UCR", "Unified Church of the Realms").length, 1);
  assert.deepEqual(structuralNameClues("UCR", "Church of Night"), []);
  assert.equal(buildReferentGroups(candidates, []).groups.length, candidates.length);
});

test("grouping does not turn two pair links into an unverified transitive merge", () => {
  const grouped = buildReferentGroups(candidates, [link(0, 1), link(1, 2)]);
  assert.deepEqual(
    grouped.groups.map((group) => group.members!.map((member) => member.index)),
    [[0, 1], [2], [3]],
  );
  assert.equal(grouped.unappliedLinkIds.length, 1);
  const complete = buildReferentGroups(candidates, [link(0, 1), link(1, 2), link(0, 2)]);
  assert.deepEqual(
    complete.groups[0]!.members!.map((member) => member.name),
    candidates.slice(0, 3).map((candidate) => candidate.name),
  );
  assert.equal(complete.groups.length, 2);
});

test("alias confidence and same-referent probability independently gate context linking", () => {
  const request = buildAliasRequest(source, candidates, pairs.slice(0, 1), "source rules");
  const manifest: Manifest = {
    operation_id: "fixture",
    decision_kind: "document_alias",
    discovery_directory: "/source",
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    candidates_sha256: "fixture",
    configuration_sha256: "fixture",
    question_version: "document-alias-v2",
    created_at_utc: "fixture",
    candidates,
    alias_pairs: pairs,
    config: { minimum_confidence: 0.9, minimum_same_probability: 0.9 },
    batches: [
      {
        batch_id: "batch-000",
        batch_sha256: sha256(JSON.stringify(request)),
        candidate_ids: [pairs[0]!.pair_id],
        request: request as never,
        input_upper_bound_tokens: 1000,
      },
    ],
  };
  const raw = {
    model: "typesafe/jev-1.13",
    provider: "TypeSafe",
    answers: {
      [pairs[0]!.pair_id]: {
        type: "choice",
        choice: "same_referent",
        confidence: 0.6,
        probabilities: { same_referent: 0.99, different_referents: 0.01, unclear: 0 },
      },
    },
  };
  assert.equal(aliasDecisionSchema.parse(validateBatchResponse(raw, manifest, "batch-000", "/raw").decisions[0]!).outcome, "unresolved");
  raw.answers[pairs[0]!.pair_id]!.confidence = 0.99;
  assert.equal(aliasDecisionSchema.parse(validateBatchResponse(raw, manifest, "batch-000", "/raw").decisions[0]!).outcome, "provisional_link");
  raw.answers[pairs[0]!.pair_id]!.probabilities = { same_referent: 0.8, different_referents: 0.2, unclear: 0 };
  assert.equal(aliasDecisionSchema.parse(validateBatchResponse(raw, manifest, "batch-000", "/raw").decisions[0]!).outcome, "unresolved");
});

test("full-source acronym scan retains dotted spellings, written expansions, and both initials rules", () => {
  const text = "Unified Church of the Realms (UCR). United Circle of Roads (U.C.R.). The Order of the Silver Dawn (OSD) is also known as TOOTSD.";
  const captured = decodeCapturedSource(Buffer.from(text));
  const names = ["Unified Church of the Realms", "UCR", "United Circle of Roads", "U.C.R.", "The Order of the Silver Dawn", "OSD", "TOOTSD"];
  const found = sourceCandidates(names, captured, "acronym-fixture");
  const scan = scanAcronymClues(captured, found);
  assert.ok(scan.acronyms.some((entry) => entry.text === "UCR"));
  assert.ok(scan.acronyms.some((entry) => entry.text === "U.C.R."));
  assert.ok(scan.pair_clues.some((clue) => clue.full_name === "Unified Church of the Realms" && clue.acronym.text === "UCR" && clue.matching_rules.includes("written_expansion")));
  assert.ok(scan.pair_clues.some((clue) => clue.full_name === "United Circle of Roads" && clue.acronym.text === "U.C.R." && clue.matching_rules.includes("written_expansion")));
  assert.ok(
    scan.pair_clues.some(
      (clue) => clue.full_name === "The Order of the Silver Dawn" && clue.acronym.text === "OSD" && clue.matching_rules.includes("without_function_words_initials"),
    ),
  );
  assert.ok(
    scan.pair_clues.some((clue) => clue.full_name === "The Order of the Silver Dawn" && clue.acronym.text === "TOOTSD" && clue.matching_rules.includes("all_words_initials")),
  );
  for (const entry of scan.acronyms) assert.equal(captured.bytes.subarray(entry.start_byte, entry.end_byte).toString("utf8"), entry.text);
});

test("written parenthetical expansions remain correction clues when initials do not match", () => {
  for (const text of ["The Lord's Alliance (QV)", "QV (The Lord's Alliance)"]) {
    const captured = decodeCapturedSource(Buffer.from(text));
    const found = sourceCandidates(["QV"], captured, `written-expansion-${text}`);
    const scan = scanAcronymClues(captured, found);
    const finding = scan.discovery_findings.find((entry) => entry.name === "The Lord's Alliance");
    assert.ok(finding, text);
    assert.equal(finding.source_span?.text, "The Lord's Alliance");
    assert.equal(finding.related_span?.text, "QV");
    assert.deepEqual(
      found.map((candidate) => candidate.name),
      ["QV"],
    );
  }
});

test("unmatched alphanumeric date markers are not acronym corrections but discovered alphanumeric names are retained", () => {
  const text = "Unified Church of the Realms (UCR) began in DR1400; DR1492 is a date marker. R2D2 is a discovered name.";
  const captured = decodeCapturedSource(Buffer.from(text));
  const found = sourceCandidates(["Unified Church of the Realms", "UCR", "R2D2"], captured, "alphanumeric-date-markers");
  const scan = scanAcronymClues(captured, found);
  assert.ok(scan.acronyms.some((entry) => entry.text === "UCR"));
  assert.ok(scan.acronyms.some((entry) => entry.text === "R2D2"));
  assert.equal(
    scan.acronyms.some((entry) => ["DR1400", "DR1492"].includes(entry.text)),
    false,
  );
  assert.equal(
    scan.discovery_findings.some((finding) => ["DR1400", "DR1492"].includes(finding.name)),
    false,
  );
  const r2d2 = scan.acronyms.find((entry) => entry.text === "R2D2")!;
  assert.equal(captured.bytes.subarray(r2d2.start_byte, r2d2.end_byte).toString("utf8"), "R2D2");
});

test("aliasIdentity keeps every candidate pair and selects exact catalog wording with full-name direction for acronyms", () => {
  const captured = decodeCapturedSource(Buffer.from("Unified Church of the Realms (UCR). A Church of Night also appears."));
  const found = sourceCandidates(["Unified Church of the Realms", "UCR", "Church of Night"], captured, "catalog-fixture");
  const planned = buildCatalogAliasQuestions(captured, found);
  assert.equal(planned.pairs.length, 3);
  const acronym = planned.questions.find((question) => question.descriptor.definition_variant === "acronym")!;
  assert.equal(acronym.descriptor.question_kind, "aliasIdentity");
  assert.deepEqual(Object.keys(acronym.question.criteria), ["same_entity", "different_entities", "unclear"]);
  assert.equal(acronym.target.name_a, "Unified Church of the Realms");
  assert.equal(acronym.target.name_b, "UCR");
  const ordinary = planned.questions.find((question) => question.descriptor.definition_variant === "standard")!;
  assert.match(ordinary.question.instructions, /aliases for the same entity/u);
});

test("mixed-case short names keep the general aliasIdentity definition", () => {
  const captured = decodeCapturedSource(Buffer.from("Cult of the Astral Thieves (Cat)"));
  const found = sourceCandidates(["Cult of the Astral Thieves", "Cat"], captured, "mixed-case-short-name");
  const planned = buildCatalogAliasQuestions(captured, found);
  assert.equal(
    planned.scan.acronyms.some((entry) => entry.text === "Cat"),
    false,
  );
  assert.equal(planned.questions[0]!.descriptor.definition_variant, "standard");
});

test("a source acronym missing from discovery remains a correction finding and is never inserted", () => {
  const captured = decodeCapturedSource(Buffer.from("Unified Church of the Realms (UCR)"));
  const found = sourceCandidates(["Unified Church of the Realms"], captured, "missing-acronym-fixture");
  const planned = buildCatalogAliasQuestions(captured, found);
  assert.deepEqual(
    found.map((candidate) => candidate.name),
    ["Unified Church of the Realms"],
  );
  assert.equal(planned.pairs.length, 0);
  assert.ok(planned.scan.discovery_findings.some((finding) => finding.name === "UCR" && finding.source_span?.text === "UCR"));
});

test("unmatched title components and independent uppercase clues stay unresolved without missing-name inference", () => {
  const captured = decodeCapturedSource(Buffer.from("Lord AO guides the church. AO later speaks independently."));
  const found = sourceCandidates(["Lord AO"], captured, "embedded-acronym-fixture");
  const scan = scanAcronymClues(captured, found);
  const aoOccurrences = scan.acronyms.filter((entry) => entry.text === "AO");
  assert.equal(aoOccurrences.length, 2);
  assert.ok(scan.unresolved.some((entry) => entry.acronym.start_byte === aoOccurrences[0]!.start_byte));
  assert.equal(
    scan.discovery_findings.some((entry) => entry.name === "AO"),
    false,
  );
  assert.ok(scan.unresolved.some((entry) => entry.acronym.start_byte === aoOccurrences[1]!.start_byte));
  assert.deepEqual(
    found.map((candidate) => candidate.name),
    ["Lord AO"],
  );
});

test("unmatched uppercase headers and dotted clues preserve exact evidence without requiring discovery", () => {
  const captured = decodeCapturedSource(Buffer.from("é | FACTION | PATRON |\n| Order | Patron |\nUNKNOWN and X.Y.Z. remain unexplained."));
  const found = sourceCandidates(["Order", "Patron"], captured, "unmatched-clues");
  const scan = scanAcronymClues(captured, found);
  assert.equal(scan.disposition_version, "source-backed-missing-names-v3");
  assert.deepEqual(
    scan.unresolved.map((entry) => entry.acronym.text),
    ["FACTION", "PATRON", "UNKNOWN", "X.Y.Z."],
  );
  assert.deepEqual(scan.discovery_findings, []);
  for (const entry of scan.unresolved) assert.equal(captured.bytes.subarray(entry.acronym.start_byte, entry.acronym.end_byte).toString("utf8"), entry.acronym.text);
});

test("undiscovered tokens with initials clues remain diagnostic without forcing discovery or asserting identity", () => {
  const captured = decodeCapturedSource(Buffer.from("Unified Church of the Realms. UCR meets here."));
  const found = sourceCandidates(["Unified Church of the Realms"], captured, "missing-initials-clue");
  const scan = scanAcronymClues(captured, found);
  assert.deepEqual(scan.discovery_findings, []);
  const clue = scan.unresolved.find((entry) => entry.acronym.text === "UCR")!;
  assert.equal(clue.possible_initials_expansions?.[0]?.full_name, "Unified Church of the Realms");
  assert.deepEqual(clue.possible_initials_expansions?.[0]?.matching_rules, ["without_function_words_initials"]);
  assert.equal(scan.pair_clues.length, 0);
  assert.deepEqual(
    found.map((candidate) => candidate.name),
    ["Unified Church of the Realms"],
  );
});

test("aliasIdentity targets contain only discovered candidates despite unresolved tokens and missing expansion evidence", () => {
  const captured = decodeCapturedSource(Buffer.from("UCR (Unified Church of the Realms). Order. FACTION PATRON X.Y.Z."));
  const found = sourceCandidates(["UCR", "Order"], captured, "discovered-pair-membership");
  const planned = buildCatalogAliasQuestions(captured, found);
  assert.deepEqual(planned.pairs, allCandidatePairs(found));
  assert.equal(planned.questions.length, 1);
  assert.deepEqual([planned.questions[0]!.target.name_a, planned.questions[0]!.target.name_b], ["UCR", "Order"]);
  assert.ok(planned.scan.discovery_findings.some((entry) => entry.name === "Unified Church of the Realms"));
  assert.deepEqual(
    found.map((candidate) => candidate.name),
    ["UCR", "Order"],
  );
});

test("written expansions on either side of a dotted acronym retain exact missing-name evidence", () => {
  for (const text of ["Unified Church of the Realms (U.C.R.)", "U.C.R. (Unified Church of the Realms)"]) {
    const captured = decodeCapturedSource(Buffer.from(text));
    const found = sourceCandidates(["U.C.R."], captured, "missing-dotted-expansion");
    const scan = scanAcronymClues(captured, found);
    const finding = scan.discovery_findings.find((entry) => entry.name === "Unified Church of the Realms");
    assert.ok(finding, text);
    assert.equal(finding.source_span?.text, "Unified Church of the Realms");
    assert.equal(finding.related_span?.text, "U.C.R.");
    assert.equal(captured.bytes.subarray(finding.source_span!.start_byte, finding.source_span!.end_byte).toString("utf8"), finding.name);
    assert.equal(captured.bytes.subarray(finding.related_span!.start_byte, finding.related_span!.end_byte).toString("utf8"), "U.C.R.");
    assert.deepEqual(
      found.map((candidate) => candidate.name),
      ["U.C.R."],
    );
  }
});

test("dotted acronym spans retain the terminal dot when discovery omitted the acronym candidate", () => {
  for (const text of ["Unified Church of the Realms (U.C.R.)", "U.C.R. (Unified Church of the Realms)"]) {
    const captured = decodeCapturedSource(Buffer.from(text));
    const found = sourceCandidates(["Unified Church of the Realms"], captured, "missing-dotted-acronym");
    const scan = scanAcronymClues(captured, found);
    const acronym = scan.acronyms.find((entry) => entry.text === "U.C.R.");
    assert.ok(acronym, text);
    assert.equal(captured.bytes.subarray(acronym.start_byte, acronym.end_byte).toString("utf8"), "U.C.R.");
    assert.ok(scan.discovery_findings.some((finding) => finding.name === "U.C.R." && finding.source_span?.text === "U.C.R."));
  }
});

test("written expansion corrections scan every occurrence and keep occurrence-specific evidence", () => {
  const text = "Unified Church of the Realms (UCR). United Circle of Roads (UCR).";
  const captured = decodeCapturedSource(Buffer.from(text));
  const found = sourceCandidates(["Unified Church of the Realms", "UCR"], captured, "repeated-acronym-expansions");
  const scan = scanAcronymClues(captured, found);
  const clues = scan.pair_clues.filter((clue) => clue.full_name === "Unified Church of the Realms" && clue.acronym.text === "UCR");
  assert.equal(clues.length, 2);
  assert.ok(clues[0]!.matching_rules.includes("written_expansion"));
  assert.equal(clues[0]!.written_expansion_evidence[0]!.text, "Unified Church of the Realms (UCR)");
  assert.equal(clues[1]!.written_expansion_evidence.length, 0);

  const correction = scan.discovery_findings.find((finding) => finding.name === "United Circle of Roads");
  assert.ok(correction);
  assert.equal(correction.source_span?.text, "United Circle of Roads");
  assert.equal(correction.related_span?.text, "UCR");
  assert.equal(correction.source_span?.start_byte, Buffer.byteLength(text.slice(0, text.indexOf("United Circle of Roads"))));
  const secondAcronymOffset = text.lastIndexOf("UCR");
  assert.equal(correction.related_span?.start_byte, Buffer.byteLength(text.slice(0, secondAcronymOffset)));
  assert.equal(captured.bytes.subarray(correction.source_span!.start_byte, correction.source_span!.end_byte).toString("utf8"), correction.name);
  assert.equal(captured.bytes.subarray(correction.related_span!.start_byte, correction.related_span!.end_byte).toString("utf8"), "UCR");
});

test("catalog grouping requires supported all-member pair evidence and preserves incomplete links", () => {
  const captured = decodeCapturedSource(Buffer.from("Alpha Order, A. Beta Order, B. Gamma Order, G."));
  const found = sourceCandidates(["Alpha Order", "Beta Order", "Gamma Order"], captured, "catalog-groups");
  const planned = buildCatalogAliasQuestions(captured, found);
  const yes = planned.questions.slice(0, 2).map((question) => ({
    question_id: question.id,
    target: question.target,
    action: {
      status: "supported" as const,
      label: "same_entity",
      policy_version: "reviewed",
      policy_sha256: "hash",
      findings: [],
    },
  }));
  const partial = buildCatalogReferentGroups(found, yes);
  assert.deepEqual(
    partial.groups.map((group) => (group.members ?? [group]).map((member) => member.name)),
    [["Alpha Order", "Beta Order"], ["Gamma Order"]],
  );
  assert.equal(partial.unappliedLinkIds.length, 1);
  assert.deepEqual(partial.conflictedGroupIds, partial.groups.map((group) => group.candidate_id));
  const complete = buildCatalogReferentGroups(found, [
    ...yes,
    {
      question_id: planned.questions[2]!.id,
      target: planned.questions[2]!.target,
      action: {
        status: "rejected" as const,
        label: "different_entities",
        policy_version: "reviewed",
        policy_sha256: "hash",
        findings: [],
      },
    },
  ]);
  assert.equal(complete.groups.length, 2);
  assert.deepEqual(complete.conflictedGroupIds, partial.conflictedGroupIds);
});

test("an incomplete supported alias component leaves an unrelated group eligible", () => {
  const captured = decodeCapturedSource(Buffer.from("Alpha Order, Beta Order, Gamma Order, and Delta Order."));
  const found = sourceCandidates(["Alpha Order", "Beta Order", "Gamma Order", "Delta Order"], captured, "catalog-conflict");
  const planned = buildCatalogAliasQuestions(captured, found);
  const selected = planned.questions.slice(0, 2);
  const grouped = buildCatalogReferentGroups(found, selected.map((question) => ({
    question_id: question.id,
    target: question.target,
    action: { status: "supported" as const, label: "same_entity", policy_version: "reviewed", policy_sha256: "hash", findings: [] },
  })));
  assert.equal(grouped.unappliedLinkIds.length, 1);
  assert.deepEqual(grouped.conflictedGroupIds, grouped.groups.slice(0, 2).map((group) => group.candidate_id));
  assert.equal(grouped.groups[2]!.members![0]!.name, "Delta Order");
  assert.ok(!grouped.conflictedGroupIds.includes(grouped.groups[2]!.candidate_id));
});

test("exploratory catalog grouping labels provisional links as trial groups only", () => {
  const captured = decodeCapturedSource(Buffer.from("Alpha Order and A. Beta Order and B."));
  const found = sourceCandidates(["Alpha Order", "Beta Order"], captured, "catalog-trial-groups");
  const planned = buildCatalogAliasQuestions(captured, found);
  const provisional = [
    {
      question_id: planned.questions[0]!.id,
      target: planned.questions[0]!.target,
      action: {
        status: "provisional" as const,
        label: "same_entity",
        policy_version: "exploratory",
        policy_sha256: "hash",
        findings: [],
      },
    },
  ];
  assert.equal(buildCatalogReferentGroups(found, provisional, "supported").groups.length, 2);
  const exploratory = buildCatalogReferentGroups(found, provisional, "exploratory");
  assert.deepEqual(
    exploratory.groups.map((group) => group.members?.map((member) => member.name)),
    [["Alpha Order", "Beta Order"]],
  );
});
