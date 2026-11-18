import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { callJev, preflightJev } from "../../domains/document/decisions/provider.js";
import { jevModel, jevProvider, jevExecutionPolicy } from "../../domains/document/decisions/execution-policy.js";
import { writeJsonAtomic, readJson } from "../../domains/document/discovery/artifacts.js";
import { loadCatalog, projectRoot } from "./catalog.js";
import { buildExperiment, experimentForWire, sourceForRequest, validateWireRequest } from "./request.js";
import { parseDecisionWire, validateDecisionAnswers } from "../../domains/document/decisions/validation.js";
import { DecisionsResponse$inboundSchema, type DecisionsRequest } from "@openrouter/sdk/models";

type Run = { id: string; status: string; startedAt: string; finishedAt?: string; durationMs?: number; request: unknown; response?: unknown; error?: string };
type Options = { directory?: string; dispatch?: typeof callJev; preflight?: typeof preflightJev };

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function safeError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => (issue.path.join(".") || "request") + ": " + issue.message).join("\n");
  return String(error instanceof Error ? error.message : error)
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2_000_000) throw new Error("Request is too large. Use less than 2 MB of JSON.");
    chunks.push(Buffer.from(chunk));
  }
  return parseDecisionWire(Buffer.concat(chunks).toString("utf8"));
}

function validateResponse(raw: unknown, request: DecisionsRequest) {
  const decoded = DecisionsResponse$inboundSchema.parse(raw);
  const ordinary = Object.fromEntries(Object.entries(request.questions).filter(([, question]) => question.type !== "score"));
  const answers = Object.fromEntries(Object.entries(decoded.answers).filter(([id]) => Object.hasOwn(ordinary, id)));
  const checked = validateDecisionAnswers({ ...decoded, answers }, ordinary, 0.02, 0.02);
  if (checked.findings.length) throw new Error("Jev response validation: " + checked.findings.join("; "));
  if (JSON.stringify(Object.keys(decoded.answers).sort()) !== JSON.stringify(Object.keys(request.questions).sort()))
    throw new Error("Jev response question IDs differ from the request.");
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type !== "score") continue;
    const answer = decoded.answers[id];
    if (answer.type !== "score" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > question.criteria.length - 1)
      throw new Error(id + ": invalid score response.");
    if (answer.confidence !== undefined && (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1))
      throw new Error(id + ": invalid score confidence.");
    const expectedKeys = question.criteria.map((_, index) => String(index));
    const weights = answer.probabilities;
    if (!weights) continue;
    if (JSON.stringify(Object.keys(weights).sort()) !== JSON.stringify(expectedKeys.sort())) throw new Error(id + ": score probability levels differ from criteria.");
    if (Object.values(weights).some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 1)) throw new Error(id + ": invalid score probability.");
    if (Math.abs(Object.values(weights).reduce((total, weight) => total + weight, 0) - 1) > 0.02) throw new Error(id + ": invalid score probability total.");
    const expectedScore = Object.entries(weights).reduce((total, [level, weight]) => total + Number(level) * weight, 0);
    if (Math.abs(answer.score - expectedScore) > 0.02) throw new Error(id + ": score differs from its probability distribution.");
  }
}

export async function createPlayground(options: Options = {}) {
  const catalog = await loadCatalog();
  const directory = options.directory ?? join(projectRoot, ".kiro/execution/jev-playground/runs");
  const token = randomUUID();
  const dispatch = options.dispatch ?? callJev;
  const preflight = options.preflight ?? preflightJev;
  let active = false;
  let readiness: { ready: boolean; message: string; inputLimit?: number; checkedAt?: string } = { ready: false, message: "Checking Jev…" };
  async function checkReadiness() {
    try {
      const result = await preflight();
      readiness = { ready: true, message: "Ready for live requests", inputLimit: result.inputLimit, checkedAt: new Date().toISOString() };
    } catch (error) {
      readiness = { ready: false, message: safeError(error), checkedAt: new Date().toISOString() };
    }
    return readiness;
  }
  await checkReadiness();
  async function history() {
    const ids = await readdir(directory).catch(() => [] as string[]);
    const runs = await Promise.all(
      ids
        .filter((id) => /^[\dTZ-]+-[a-f\d-]+$/.test(id))
        .sort()
        .reverse()
        .slice(0, 40)
        .map(async (id) => {
          try {
            const run = (await readJson(join(directory, id, "run.json"))) as Run;
            const saved = run.request as DecisionsRequest;
            const state = saved.state && typeof saved.state === "object" && !Array.isArray(saved.state) ? saved.state : undefined;
            const targets = state?.targets as Record<string, unknown> | undefined;
            const answers = (run.response as { answers?: Record<string, unknown> } | undefined)?.answers ?? {};
            return {
              id: run.id,
              status: run.status,
              startedAt: run.startedAt,
              durationMs: run.durationMs,
              count: Object.keys((run.request as { questions: object }).questions).length,
              error: run.error,
              results:
                run.status === "complete"
                  ? Object.entries(answers).map(([id, answer]) => ({
                      id,
                      answer,
                      target: targets?.[id] ?? state?.target,
                      instructions: saved.questions[id]?.instructions,
                      maximum: saved.questions[id]?.type === "score" ? saved.questions[id].criteria.length - 1 : undefined,
                    }))
                  : [],
            };
          } catch {
            return null;
          }
        }),
    );
    return runs.filter(Boolean).sort((a, b) => Date.parse(b!.startedAt) - Date.parse(a!.startedAt));
  }
  function authorized(request: IncomingMessage) {
    const supplied = Buffer.from(String(request.headers["x-jev-lab-token"] ?? ""));
    const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      const host = String(request.headers.host ?? "");
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return json(response, 403, { error: "This playground is local only." });
      if (request.headers.origin && new URL(request.headers.origin).host !== host) return json(response, 403, { error: "Use this page's own request editor." });
      const url = new URL(request.url ?? "/", "http://" + host);
      const staticFiles: Record<string, [string, string]> = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/bindings.js": ["bindings.js", "text/javascript"],
        "/catalog.js": ["catalog.js", "text/javascript"],
        "/editors.js": ["editors.js", "text/javascript"],
        "/results.js": ["results.js", "text/javascript"],
        "/styles.css": ["styles.css", "text/css"],
        "/editors.css": ["editors.css", "text/css"],
        "/results.css": ["results.css", "text/css"],
        "/pipeline.css": ["pipeline.css", "text/css"],
        "/responsive.css": ["responsive.css", "text/css"],
      };
      if (request.method === "GET" && staticFiles[url.pathname]) {
        const [file, type] = staticFiles[url.pathname];
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
        );
        response.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
        return response.end(await readFile(new URL("./web/" + file, import.meta.url)));
      }
      if (request.method === "GET" && url.pathname === "/api/bootstrap") return json(response, 200, { ...catalog, token, readiness, model: jevModel, provider: jevProvider });
      if (!authorized(request)) return json(response, 403, { error: "Refresh the page to reconnect to the local server." });
      if (request.method === "GET" && url.pathname === "/api/history") return json(response, 200, await history());
      if (request.method === "GET" && url.pathname.startsWith("/api/runs/")) {
        const id = url.pathname.slice("/api/runs/".length);
        if (!/^[\dTZ-]+-[a-f\d-]+$/.test(id)) return json(response, 400, { error: "Unknown run." });
        return json(response, 200, await readJson(join(directory, id, "run.json")));
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/documents/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/documents/".length));
        if (!catalog.documents.some((document) => document.id === id)) return json(response, 404, { error: "Document not found." });
        return json(response, 200, { id, source: await readFile(join(projectRoot, "Resources/Lore", id), "utf8") });
      }
      if (request.method === "POST" && url.pathname === "/api/ready") return json(response, 200, await checkReadiness());
      if (request.method === "POST" && url.pathname === "/api/import") {
        const input = z
          .object({ requestText: z.string() })
          .strict()
          .parse(await body(request));
        const parsed = parseDecisionWire(input.requestText);
        const raw = parsed && typeof parsed === "object" && "request" in parsed ? parsed.request : parsed;
        const prepared = validateWireRequest(raw);
        return json(response, 200, { request: prepared.wire, experiment: experimentForWire(prepared.wire) });
      }
      if (request.method === "POST" && ["/api/preview", "/api/run"].includes(url.pathname)) {
        const input = z
          .object({
            mode: z.enum(["form", "json"]),
            request: z.unknown().optional(),
            requestText: z.string().optional(),
            experiment: z.unknown().optional(),
          })
          .strict()
          .parse(await body(request));
        const prepared =
          input.mode === "json" ? validateWireRequest(input.requestText === undefined ? input.request : parseDecisionWire(input.requestText)) : buildExperiment(input.experiment);
        if (url.pathname === "/api/preview") return json(response, 200, { request: prepared.wire });
        if (active) return json(response, 409, { error: "Another Jev request is still running. Its result will appear shortly." });
        if (!readiness.ready && !(await checkReadiness()).ready) return json(response, 503, { error: readiness.message });
        const bytes = Buffer.byteLength(JSON.stringify(prepared.wire), "utf8");
        if (readiness.inputLimit && bytes > readiness.inputLimit)
          return json(response, 413, { error: "This request exceeds the conservative context allowance. Shorten the context or reduce the batch." });
        if (active) return json(response, 409, { error: "Another Jev request is still running." });
        active = true;
        const started = Date.now();
        const id =
          new Date(started)
            .toISOString()
            .replaceAll(":", "-")
            .replace(/\.\d{3}/, "") +
          "-" +
          randomUUID();
        const run: Run = { id, status: "running", startedAt: new Date(started).toISOString(), request: prepared.wire };
        try {
          await writeJsonAtomic(join(directory, id, "run.json"), run);
          run.response = await dispatch(prepared.request, join(directory, id, "attempt"), false, sourceForRequest(prepared.request));
          validateResponse(run.response, prepared.request);
          run.status = "complete";
        } catch (error) {
          run.status = "failed";
          run.error = safeError(error);
        } finally {
          active = false;
          run.finishedAt = new Date().toISOString();
          run.durationMs = Date.now() - started;
          await writeJsonAtomic(join(directory, id, "run.json"), run);
        }
        return json(response, 200, run);
      }
      return json(response, 404, { error: "Not found." });
    } catch (error) {
      return json(response, 400, { error: safeError(error) });
    }
  });
  server.requestTimeout = jevExecutionPolicy.requestTimeoutMs + 30_000;
  server.headersTimeout = 30_000;
  return { server, directory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, directory } = await createPlayground();
  const port = Number(process.env.JEV_PLAYGROUND_PORT ?? 4317);
  server.listen(port, "127.0.0.1", () => {
    console.log("Jev Lab is running locally at http://localhost:" + port);
    console.log("Diagnostic runs: " + directory);
  });
  server.on("error", (error) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
