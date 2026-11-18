import { populateCatalog } from "./catalog.js";
import { bindControls } from "./bindings.js";
import { element, renderQuestions } from "./editors.js";
import { renderRun, renderHistory } from "./results.js";

const $ = (id) => document.getElementById(id);
const storageKey = "jev-lab-draft-v1";
let bootstrap;
let draft;
let lastRun;
let currentWire;
let previewError = true;
let busy = false;
let previewTimer;
let previewSequence = 0;
let rawMode = false;

function notify(text, good = false) {
  $("message").textContent = text;
  $("message").classList.toggle("good", good);
  $("message").hidden = !text;
}

async function api(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Jev-Lab-Token": bootstrap?.token ?? "" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "HTTP " + response.status);
  return body;
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== name;
  });
  if (name === "history") refreshHistory().catch((error) => notify(error.message));
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ draft, rawMode, rawJSON: $("request-json").value }));
  } catch {
    /* Large temporary drafts can still run without browser storage. */
  }
}

function payload() {
  if (rawMode) {
    JSON.parse($("request-json").value);
    return { mode: "json", requestText: $("request-json").value };
  }
  if (document.querySelector('#questions [data-invalid="true"]')) throw new Error("Complete or correct the highlighted input.");
  draft.source = $("source").value;
  try {
    draft.extraState = JSON.parse($("extra-state").value);
  } catch {
    throw new Error("Additional context must be valid JSON. Correct the highlighted field.");
  }
  if (!draft.extraState || typeof draft.extraState !== "object" || Array.isArray(draft.extraState)) throw new Error("Additional context must be a JSON object.");
  return { mode: "form", experiment: draft };
}

function updateButton() {
  $("run").disabled = busy || previewError || !bootstrap?.readiness.ready;
}

async function preview() {
  const sequence = ++previewSequence;
  try {
    const input = payload();
    const result = await api("/api/preview", input);
    if (sequence !== previewSequence) return;
    currentWire = result.request;
    if (!rawMode) $("request-json").value = JSON.stringify(result.request, null, 2);
    previewError = false;
    $("request-status").textContent = Object.keys(result.request.questions).length + " question(s) · valid";
    $("request-status").className = "validity good";
    $("extra-state").classList.remove("invalid-json");
  } catch (error) {
    if (sequence !== previewSequence) return;
    currentWire = undefined;
    previewError = true;
    $("request-status").textContent = error.message;
    $("request-status").className = "validity bad";
    if (!rawMode) {
      try {
        JSON.parse($("extra-state").value);
      } catch {
        $("extra-state").classList.add("invalid-json");
      }
    }
  }
  save();
  updateButton();
}

function changed() {
  ++previewSequence;
  previewError = true;
  currentWire = undefined;
  if (!rawMode) draft.source = $("source").value;
  $("request-status").textContent = "Validating…";
  $("request-status").className = "validity";
  updateButton();
  $("source-size").textContent = $("source").value.length.toLocaleString() + " characters";
  clearTimeout(previewTimer);
  previewTimer = setTimeout(preview, 250);
}

function renderEditors(replaceContext = false) {
  if (replaceContext) {
    $("source").value = draft.source;
    $("extra-state").value = JSON.stringify(draft.extraState, null, 2);
  }
  $("extra-state-count").textContent = Object.keys(draft.extraState).length ? Object.keys(draft.extraState).length + " field(s)" : "";
  $("question-count").textContent = String(draft.questions.length);
  $("experiment-description").textContent = draft.description ?? "Custom experiment · edit freely.";
  document.querySelectorAll(".preset").forEach((button) => button.classList.toggle("active", button.dataset.case === draft.id));
  renderQuestions($("questions"), draft.questions, {
    change: changed,
    remove: (index) => {
      draft.questions.splice(index, 1);
      renderEditors();
      changed();
    },
    duplicate: (index) => {
      const question = structuredClone(draft.questions[index]);
      question.id = uniqueId(question.id + "_copy");
      draft.questions.splice(index + 1, 0, question);
      renderEditors();
      changed();
    },
  });
}

function uniqueId(base) {
  let id = base;
  let suffix = 2;
  while (draft.questions.some((q) => q.id === id)) id = base + "_" + suffix++;
  return id;
}

function setRawMode(value) {
  rawMode = value;
  $("json-mode").checked = value;
  $("request-json").readOnly = !value;
  $("json-help").textContent = value ? "Raw JSON is active. The form editors are paused." : "The preview updates as you edit.";
  document
    .querySelectorAll(
      "#source, #extra-state, #document, #questions input, #questions textarea, #questions select, #questions button, #add-custom, #add-macro, #import-source, #clear-source",
    )
    .forEach((input) => {
      if (value) {
        if (input.dataset.formDisabled === undefined) input.dataset.formDisabled = String(input.disabled);
        input.disabled = true;
      } else if (input.dataset.formDisabled !== undefined) {
        input.disabled = input.dataset.formDisabled === "true";
        delete input.dataset.formDisabled;
      }
    });
  if (value) $("request-details").open = true;
}

function loadExperiment(experiment) {
  draft = structuredClone(experiment);
  rawMode = false;
  $("document").value = "";
  renderEditors(true);
  setRawMode(false);
  notify("");
  changed();
}

function loadMacro(id, add = false) {
  const macro = bootstrap.macros.find((item) => item.id === id);
  const question = structuredClone(macro.question);
  if (!add)
    loadExperiment({
      id: "macro-" + id,
      title: macro.title,
      description: id + " · " + macro.title + " · " + macro.status,
      source: bootstrap.sampleSource,
      questions: [question],
      extraState: macro.extraState,
    });
  else {
    try {
      payload();
    } catch (error) {
      notify(error.message);
      return;
    }
    setRawMode(false);
    question.id = uniqueId(question.id);
    draft.questions.push(question);
    draft.extraState = { ...macro.extraState, ...draft.extraState };
    $("extra-state").value = JSON.stringify(draft.extraState, null, 2);
    renderEditors();
    changed();
  }
  showTab("workbench");
}

async function importWire(wire) {
  const imported = await api("/api/import", { requestText: typeof wire === "string" ? wire : JSON.stringify(wire) });
  if (imported.experiment) {
    loadExperiment({ ...imported.experiment, id: "imported", description: "Imported request · edit and run again." });
  } else {
    $("request-json").value = JSON.stringify(imported.request, null, 2);
    setRawMode(true);
    $("request-details").scrollIntoView({ behavior: "smooth", block: "center" });
    changed();
  }
}

function download(value, name) {
  const link = element("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showRun(run) {
  lastRun = run;
  renderRun($("results"), run);
  $("result-meta").textContent = new Date(run.startedAt).toLocaleTimeString() + " · " + run.status;
  $("response-json").textContent = JSON.stringify({ request: run.request, response: run.response, error: run.error }, null, 2);
  $("raw-result").hidden = false;
  $("load-result").hidden = false;
  $("export-result").hidden = false;
}

async function refreshHistory() {
  const runs = await api("/api/history");
  $("history-count").textContent = String(runs.length);
  renderHistory(
    $("history-list"),
    runs,
    async (id) => {
      try {
        showRun(await api("/api/runs/" + id));
        showTab("workbench");
        $("results-panel").scrollIntoView({ behavior: "smooth" });
      } catch (error) {
        notify(error.message);
      }
    },
    async (id) => {
      try {
        const run = await api("/api/runs/" + id);
        await importWire(run.request);
        showTab("workbench");
      } catch (error) {
        notify(error.message);
      }
    },
  );
}

async function run() {
  if (busy) return;
  let input;
  try {
    input = payload();
  } catch (error) {
    notify(error.message);
    return;
  }
  busy = true;
  updateButton();
  notify("");
  const start = Date.now();
  const running = element("div", "running");
  const label = element("span", "", "Jev is evaluating the request…");
  running.append(element("span", "spinner"), label);
  $("results").replaceChildren(running);
  $("raw-result").hidden = true;
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    $("run-label").textContent = "Running · " + elapsed + "s";
    label.textContent = "Jev is evaluating the request · " + elapsed + "s";
  }, 500);
  try {
    showRun(await api("/api/run", input));
    await refreshHistory();
    $("results-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("results").replaceChildren(element("div", "failure", error.message));
  } finally {
    clearInterval(timer);
    busy = false;
    $("run-label").textContent = "Run Jev";
    updateButton();
  }
}

function showReadiness(readiness) {
  bootstrap.readiness = readiness;
  $("connection-status").textContent = readiness.ready ? "Live · ready" : "Not ready";
  $("status-dot").className = "dot" + (readiness.ready ? "" : " failed");
  $("check-connection").hidden = readiness.ready;
  notify(readiness.ready ? "" : readiness.message);
  updateButton();
}

async function start() {
  bootstrap = await api("/api/bootstrap");
  showReadiness(bootstrap.readiness);
  $("model-label").textContent = bootstrap.model;
  populateCatalog(bootstrap, { $, loadExperiment, loadMacro });
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    /* Start with a usable preset. */
  }
  if (stored?.draft?.questions && Array.isArray(stored.draft.questions)) {
    draft = stored.draft;
    renderEditors(true);
    if (stored.rawMode) {
      $("request-json").value = stored.rawJSON;
      setRawMode(true);
    }
    changed();
  } else loadExperiment(bootstrap.cases[0]);
  bindControls(
    {
      get rawMode() {
        return rawMode;
      },
      get draft() {
        return draft;
      },
      get currentWire() {
        return currentWire;
      },
      get lastRun() {
        return lastRun;
      },
      get bootstrap() {
        return bootstrap;
      },
    },
    { $, api, showReadiness, changed, importWire, setRawMode, notify, uniqueId, renderEditors, run, showTab, loadMacro, refreshHistory, download },
  );
  await refreshHistory();
}

start().catch((error) => {
  $("connection-status").textContent = "Connection failed";
  notify(error.message);
});
