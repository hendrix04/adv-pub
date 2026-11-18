export function bindControls(state, actions) {
  const { $, api, showReadiness, changed, importWire, setRawMode, notify, uniqueId, renderEditors, run, showTab, loadMacro, refreshHistory, download } = actions;
  $("check-connection").addEventListener("click", async () => {
    $("check-connection").disabled = true;
    try {
      showReadiness(await api("/api/ready", {}));
    } catch (error) {
      notify(error.message);
    } finally {
      $("check-connection").disabled = false;
    }
  });
  $("source").addEventListener("input", changed);
  $("extra-state").addEventListener("input", changed);
  $("request-json").addEventListener("input", changed);
  $("json-mode").addEventListener("change", async () => {
    if (!$("json-mode").checked) {
      try {
        await importWire($("request-json").value);
        if (state.rawMode) throw new Error("This arbitrary state needs raw mode. Use a preset or macro to return to forms.");
      } catch (error) {
        $("json-mode").checked = true;
        notify(error.message);
        return;
      }
    } else setRawMode(true);
    changed();
  });
  $("document").addEventListener("change", async () => {
    if (!$("document").value) return;
    try {
      const document = await api("/api/documents/" + encodeURIComponent($("document").value));
      $("source").value = document.source;
      state.draft.source = document.source;
      changed();
    } catch (error) {
      notify(error.message);
    }
  });
  $("load-macro").addEventListener("click", () => loadMacro($("macro").value));
  $("add-macro").addEventListener("click", () => loadMacro($("macro").value, true));
  $("add-custom").addEventListener("click", () => {
    const question = structuredClone(state.bootstrap.cases.find((item) => item.id === "custom").questions[0]);
    question.id = uniqueId("question_" + (state.draft.questions.length + 1));
    state.draft.questions.push(question);
    renderEditors();
    changed();
  });
  $("run").addEventListener("click", run);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!$("run").disabled) run();
    }
  });
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
  document.querySelectorAll("[data-macro]").forEach((button) => button.addEventListener("click", () => loadMacro(button.dataset.macro)));
  $("refresh-history").addEventListener("click", () => refreshHistory().catch((error) => notify(error.message)));
  $("copy-request").addEventListener("click", async () => {
    try {
      if (!state.currentWire) throw new Error("Fix the request before copying.");
      await navigator.clipboard.writeText(JSON.stringify(state.currentWire, null, 2));
      notify("Request JSON copied.", true);
    } catch (error) {
      notify(error.message);
    }
  });
  $("export-request").addEventListener("click", () => {
    if (state.currentWire) download(state.currentWire, "jev-request.json");
    else notify("Fix the request before downloading.");
  });
  $("export-result").addEventListener("click", () => {
    if (state.lastRun) download(state.lastRun, "jev-run-" + state.lastRun.id + ".json");
  });
  $("load-result").addEventListener("click", async () => {
    try {
      if (state.lastRun) await importWire(state.lastRun.request);
    } catch (error) {
      notify(error.message);
    }
  });
  $("import-source").addEventListener("click", () => $("source-file").click());
  $("source-file").addEventListener("change", async () => {
    const file = $("source-file").files[0];
    if (file) {
      $("source").value = await file.text();
      state.draft.source = $("source").value;
      changed();
    }
    $("source-file").value = "";
  });
  $("clear-source").addEventListener("click", () => {
    $("source").value = "";
    changed();
  });
  $("import-request").addEventListener("click", () => $("request-file").click());
  $("request-file").addEventListener("change", async () => {
    try {
      const file = $("request-file").files[0];
      if (file) {
        await importWire(await file.text());
      }
    } catch (error) {
      notify("Could not import JSON: " + error.message);
    }
    $("request-file").value = "";
  });
}
