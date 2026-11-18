import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecisionsRequest } from "@openrouter/sdk/models";
import { loadCatalog } from "./catalog.js";
import { buildExperiment, experimentForWire, validateWireRequest, sourceForRequest } from "./request.js";
import { createPlayground } from "./server.js";
import { definitionsData } from "../../domains/document/decisions/questions.js";
import { jevModel } from "../../domains/document/decisions/execution-policy.js";
import { assertSemanticSource } from "../../domains/document/decisions/semantic-input.js";
import { callJev } from "../../domains/document/decisions/provider.js";

test("every catalog question, variant, and failure case produces a bound complete-source request", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(
    catalog.macros.filter((m) => m.id !== "Q05-acronym").map((m) => m.id),
    Array.from({ length: 20 }, (_, i) => "Q" + String(i + 1).padStart(2, "0")),
  );
  assert.equal(catalog.documents.length, 9);
  const alias = catalog.macros.find((macro) => macro.id === "Q05")!;
  assert.equal(alias.question.instructions, definitionsData.aliasIdentity.instructions + "\n\n" + definitionsData.aliasIdentity.guidance);
  for (const macro of catalog.macros) {
    const { request } = buildExperiment({ source: catalog.sampleSource, extraState: macro.extraState, questions: [macro.question] });
    assertSemanticSource(request, Buffer.from(catalog.sampleSource));
  }
  for (const experiment of catalog.cases) {
    const { request } = buildExperiment(experiment);
    assertSemanticSource(request, Buffer.from(experiment.source));
    if (experiment.questions.length > 1) {
      for (const [id, question] of Object.entries(request.questions)) assert(String(question.instructions).includes("targets[" + JSON.stringify(id) + "]"));
    }
  }
});

test("custom content supports all three primitives and arbitrary state without changing provider routing", () => {
  const raw = {
    model: jevModel,
    provider: { only: ["typesafe"], allow_fallbacks: false },
    state: "Any content, not just lore.",
    questions: {
      choice: { type: "choice", instructions: { task: "Pick one." }, criteria: { a: null, b: "Another choice." } },
      yes: { type: "noul", instructions: "Is this text?" },
      score: { type: "score", instructions: "Rate clarity.", criteria: ["Unclear", "Clear"] },
    },
  };
  assert.deepEqual(validateWireRequest(raw).wire, raw);
  assert.equal(sourceForRequest(validateWireRequest(raw).request), undefined);
  for (const state of ["text", ["array"], { ticket: { body: "My checkout broke." } }]) assert.deepEqual(validateWireRequest({ ...raw, state }).wire.state, state);
  assert.throws(() => validateWireRequest({ ...raw, model: "a-different-model" }));
  assert.throws(() => validateWireRequest({ ...raw, provider: { only: ["typesafe"], allow_fallbacks: true } }));
  assert.throws(() => validateWireRequest({ ...raw, questions: { one: { type: "choice", instructions: "Pick", criteria: { a: "Only one." } } } }));
  const question = { id: "same", type: "noul", instructions: "Is this text?", criteria: { true: "Yes.", false: "No." }, target: {} };
  assert.throws(() => buildExperiment({ source: "text", questions: [question, question] }), /unique/);
});

test("imports use forms only after a lossless round trip and reject invalid source manifests", async () => {
  const catalog = await loadCatalog();
  for (const preset of catalog.cases) {
    const { wire } = buildExperiment(preset);
    const form = experimentForWire(wire);
    assert(form, preset.id);
    assert.deepEqual(buildExperiment(form).wire, wire);
  }
  const raw = {
    model: jevModel,
    provider: { only: ["typesafe"], allow_fallbacks: false },
    state: {
      complete_source: "CONTENT TO PRESERVE",
      targets: { helper: { label: "critical context" } },
    },
    questions: { q: { type: "choice", instructions: "Choose based on targets.helper.label.", criteria: { a: "critical context", b: "other" } } },
  };
  assert.equal(experimentForWire(raw), undefined, "Unbound helper context must remain raw");
  const optionalCriteria = { ...raw, state: { complete_source: "ALPHA" }, questions: { yes: { type: "noul", instructions: "Is this text?" } } };
  assert.equal(experimentForWire(optionalCriteria), undefined, "Optional criteria remain valid in raw mode");
  assert.deepEqual(validateWireRequest(optionalCriteria).wire, optionalCriteria);
  const metadata = {
    ...optionalCriteria,
    session_id: "keep-session",
    user: "keep-user",
    trace: {
      trace_id: "trace-123",
      trace_name: "preserve-name",
      span_name: "keep-span",
      generation_name: "keep-generation",
      parent_span_id: "keep-parent",
      custom_metadata: { nested: ["preserve"] },
      traceId: "custom-camelCase",
      additionalProperties: { custom: true },
      empty: null,
    },
  };
  assert.deepEqual(validateWireRequest(metadata).wire, metadata);
  assert.equal(experimentForWire(metadata), undefined);
  assert.throws(
    () => validateWireRequest({ ...optionalCriteria, questions: { yes: { ...optionalCriteria.questions.yes, unsupported: "must not disappear" } } }),
    /serialization would change/,
  );
  const { wire } = buildExperiment(catalog.cases[0]);
  assert.equal(experimentForWire({ ...wire, session_id: "preserve-session", trace: { label: "preserve-trace" }, user: "preserve-user" }), undefined);
  assert.throws(() => validateWireRequest({ ...raw, state: { complete_source: "alpha", source_sha256: "wrong", source_byte_length: 5 } }), /manifest differs/);
});

test("generic transport preserves raw wire while pipeline transport checks immutable source before network", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-lab-transport-"));
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousLedger = process.env.BB_LIVE_COST_LEDGER;
  let calls = 0;
  try {
    process.env.OPENROUTER_API_KEY = "unit-test-credential";
    delete process.env.BB_LIVE_COST_LEDGER;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ model: jevModel, provider: "TypeSafe", answers: { yes: { type: "noul", noul: 1 } }, usage: { input_tokens: 1, output_tokens: 1, cost: 0 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const raw = {
      model: jevModel,
      provider: { only: ["typesafe"], allow_fallbacks: false },
      trace: { trace_id: "mock-trace", trace_name: "keep-name", custom_metadata: { nested: ["keep"] } },
      state: "text",
      questions: { yes: { type: "noul", instructions: "Is this text?" } },
    };
    const { request } = validateWireRequest(raw);
    const response = await callJev(request, join(directory, "generic"), false);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "generic/outbound-request.json"), "utf8")), raw);
    assert.equal((response as { model: string }).model, jevModel);
    const { request: pipeline } = buildExperiment({
      source: "original text",
      questions: [{ id: "yes", type: "noul", instructions: "Is this text?", criteria: { true: "Yes.", false: "No." }, target: {} }],
    });
    await assert.rejects(callJev(pipeline, join(directory, "pipeline"), false, Buffer.from("changed source")));
    assert.equal(calls, 1, "Mismatched pipeline source never reaches the provider");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousLedger === undefined) delete process.env.BB_LIVE_COST_LEDGER;
    else process.env.BB_LIVE_COST_LEDGER = previousLedger;
    await rm(directory, { recursive: true, force: true });
  }
});

test("local API rejects invalid and overlapping submissions and retains successful and failed runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-lab-http-"));
  let calls = 0;
  let release: (() => void) | undefined;
  let pause = false;
  let corruptScore = false;
  let scoreConfidence = 1;
  const dispatch = async (request: DecisionsRequest) => {
    calls += 1;
    if (pause)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {
      model: jevModel,
      provider: "TypeSafe",
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => [
          id,
          question.type === "score" ? { type: "score", score: 1, probabilities: { "0": corruptScore ? 1 : 0, "1": 1 }, confidence: scoreConfidence } : { type: "noul", noul: 1 },
        ]),
      ),
      usage: { input_tokens: 1, output_tokens: 1, cost: 0 },
    };
  };
  const { server } = await createPlayground({ directory, dispatch, preflight: async () => ({ inputLimit: 200_000 }) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = "http://127.0.0.1:" + address.port;
  const bootstrap = (await (await fetch(origin + "/api/bootstrap")).json()) as { token: string };
  const headers = { "Content-Type": "application/json", "X-Jev-Lab-Token": bootstrap.token };
  const raw = { model: jevModel, provider: { only: ["typesafe"], allow_fallbacks: false }, state: "text", questions: { yes: { type: "noul", instructions: "Is this text?" } } };
  const post = (value: unknown, custom: Record<string, string> = headers) => fetch(origin + "/api/run", { method: "POST", headers: custom, body: JSON.stringify(value) });
  try {
    assert.equal((await post({ mode: "json", request: raw }, { ...headers, "X-Jev-Lab-Token": "" })).status, 403);
    assert.equal((await post({ mode: "json", request: { ...raw, questions: {} } })).status, 400);
    assert.equal((await post({ mode: "json", requestText: '{"model":"x","model":"y"}' })).status, 400);
    assert.equal((await post({ mode: "json", request: raw }, { ...headers, Origin: "https://elsewhere.example" })).status, 403);
    assert.equal(calls, 0);
    pause = true;
    const first = post({ mode: "json", request: raw });
    for (let attempt = 0; attempt < 100 && !release; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert(release, "First request reached dispatch");
    assert.equal((await post({ mode: "json", request: raw })).status, 409);
    release();
    const completed = (await (await first).json()) as { status: string; id: string; request: unknown };
    assert.equal(completed.status, "complete");
    assert.deepEqual(completed.request, raw);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(await readFile(join(directory, completed.id, "run.json"), "utf8")).request, raw);
    const history = (await (await fetch(origin + "/api/history", { headers })).json()) as Array<{ results: Array<{ id: string; answer: unknown }> }>;
    assert.equal(history.length, 1);
    assert.deepEqual(
      history[0]!.results.map(({ id, answer }) => ({ id, answer })),
      [{ id: "yes", answer: { type: "noul", noul: 1 } }],
    );
    const retrieved = (await (await fetch(origin + "/api/runs/" + completed.id, { headers })).json()) as { status: string };
    assert.equal(retrieved.status, "complete");
    pause = false;
    const wrongType = { ...raw, questions: { yes: { type: "choice", instructions: "Pick.", criteria: { a: "A.", b: "B." } } } };
    const failed = (await (await post({ mode: "json", request: wrongType })).json()) as { status: string; error: string; response: unknown };
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /validation/);
    assert(failed.response, "Malformed provider output remains inspectable");
    const score = { ...raw, questions: { score: { type: "score", instructions: "Rate clarity.", criteria: ["Unclear", "Clear"] } } };
    assert.equal(((await (await post({ mode: "json", request: score })).json()) as { status: string }).status, "complete");
    corruptScore = true;
    const corrupt = (await (await post({ mode: "json", request: score })).json()) as { status: string; error: string };
    assert.equal(corrupt.status, "failed");
    assert.match(corrupt.error, /probability total/);
    corruptScore = false;
    scoreConfidence = 400;
    const badConfidence = (await (await post({ mode: "json", request: score })).json()) as { status: string; error: string };
    assert.equal(badConfidence.status, "failed");
    assert.match(badConfidence.error, /score confidence/);
    const summaries = (await (await fetch(origin + "/api/history", { headers })).json()) as Array<{
      status: string;
      results: Array<{ answer: unknown; maximum?: number }>;
      error?: string;
    }>;
    assert(summaries.filter((run) => run.status === "failed").every((run) => run.results.length === 0 && run.error));
    assert(summaries.some((run) => run.status === "complete" && run.results.some((result) => result.maximum === 1)));
    const imported = (await (await fetch(origin + "/api/import", { method: "POST", headers, body: JSON.stringify({ requestText: JSON.stringify(raw) }) })).json()) as {
      request: unknown;
      experiment?: unknown;
    };
    assert.deepEqual(imported.request, raw);
    assert.equal(imported.experiment, undefined);
    assert.equal((await fetch(origin + "/api/import", { method: "POST", headers, body: JSON.stringify({ requestText: '{"model":"x","model":"y"}' }) })).status, 400);
    for (const path of [
      "/",
      "/app.js",
      "/bindings.js",
      "/catalog.js",
      "/editors.js",
      "/results.js",
      "/styles.css",
      "/editors.css",
      "/results.css",
      "/pipeline.css",
      "/responsive.css",
    ])
      assert.equal((await fetch(origin + path)).status, 200, path);
  } finally {
    release?.();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  }
});
