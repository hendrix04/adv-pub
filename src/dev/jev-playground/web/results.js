import { element } from "./editors.js";

const percentage = (value) => (100 * Number(value)).toFixed(1) + "%";

function targetLabel(target) {
  const names = target?.candidate?.names;
  return typeof target?.name_a === "string" && typeof target?.name_b === "string"
    ? target.name_a + " ↔ " + target.name_b
    : Array.isArray(names)
      ? names.filter((name) => typeof name === "string").join(", ")
      : undefined;
}

function probability(container, label, value, winner = false) {
  const row = element("div", "probability-row");
  const heading = element("div", "probability-label");
  heading.append(element("span", "", label), element("span", "", percentage(value)));
  const track = element("div", "probability-track");
  const bar = element("div", "probability-bar" + (winner ? " winner" : ""));
  bar.style.width = Math.max(0, Math.min(100, Number(value) * 100)) + "%";
  track.append(bar);
  row.append(heading, track);
  container.append(row);
}

export function renderRun(container, run) {
  container.replaceChildren();
  if (run.error) container.append(element("div", "failure", run.error));
  if (run.error || !run.response?.answers) return;
  const summary = element("div", "result-summary");
  const response = run.response;
  const usage = response.usage ?? {};
  for (const [key, value] of [
    ["Model", response.model],
    ["Provider", response.provider],
    ["Time", (run.durationMs / 1000).toFixed(2) + " s"],
    ["Input", usage.input_tokens ?? usage.inputTokens],
    ["Output", usage.output_tokens ?? usage.outputTokens],
    ["Cost", typeof usage.cost === "number" ? "$" + usage.cost.toFixed(6) : undefined],
  ]) {
    if (value === undefined) continue;
    const stat = element("span");
    stat.append(document.createTextNode(key + " "), element("strong", "", String(value)));
    summary.append(stat);
  }
  container.append(summary);
  const cards = element("div", "result-cards");
  for (const [id, answer] of Object.entries(response.answers)) {
    const card = element("article", "result-card");
    const heading = element("div", "result-heading");
    const selected = answer.type === "choice" ? answer.choice : answer.type === "noul" ? percentage(answer.noul) + " yes" : "Level " + Number(answer.score).toFixed(2);
    heading.append(element("span", "result-id", id), element("span", "result-choice", String(selected)));
    card.append(heading);
    const state = run.request.state;
    const target = state && typeof state === "object" ? (state.targets?.[id] ?? state.target) : undefined;
    const label = targetLabel(target);
    if (label) card.append(element("div", "field-label", label));
    const wording = run.request.questions[id]?.instructions;
    card.append(element("div", "result-question", typeof wording === "string" ? wording : JSON.stringify(wording)));
    if (answer.type === "noul") {
      probability(card, "Yes", answer.noul, answer.noul >= 0.5);
      probability(card, "No", 1 - answer.noul, answer.noul < 0.5);
    } else {
      const weights = Array.isArray(answer.probabilities) ? answer.probabilities.map((value, index) => [String(index), value]) : Object.entries(answer.probabilities ?? {});
      for (const [label, value] of weights) probability(card, label, value, label === answer.choice);
    }
    const foot =
      typeof answer.confidence === "number"
        ? "Confidence " + percentage(answer.confidence) + " · model estimate, not measured accuracy"
        : answer.type === "noul"
          ? "Probability of yes · no separate confidence"
          : "Expected score across the levels · no separate confidence";
    card.append(element("div", "result-foot", foot));
    cards.append(card);
  }
  container.append(cards);
}

export function renderHistory(container, runs, openRun, replayRun) {
  container.replaceChildren();
  if (!runs.length) {
    const empty = element("div", "empty");
    empty.append(element("h3", "", "No live runs yet."), element("p", "", "Your requests and results will be saved here."));
    container.append(empty);
    return;
  }
  for (const run of runs) {
    const row = element("article", "history-row");
    const info = element("div", "history-info");
    const badge = element("span", "history-badge" + (run.status === "failed" ? " failed" : ""), run.status);
    const time = element("time", "", new Date(run.startedAt).toLocaleString());
    time.dateTime = run.startedAt;
    info.append(
      badge,
      time,
      element("small", "", run.count + " question" + (run.count === 1 ? "" : "s") + " · " + (run.durationMs ? (run.durationMs / 1000).toFixed(2) + " s" : "in progress")),
    );
    const toolbar = element("div", "toolbar");
    const view = element("button", "button small", "View result");
    view.addEventListener("click", () => openRun(run.id));
    const replay = element("button", "button small", "Load request");
    replay.addEventListener("click", () => replayRun(run.id));
    toolbar.append(view, replay);
    const header = element("div", "history-header");
    header.append(info, toolbar);
    row.append(header);
    if (run.results?.length) {
      const table = element("table", "history-results");
      const caption = element("caption", "", "Saved results · model estimates");
      const head = element("thead");
      const headings = element("tr");
      for (const label of ["Question", "Result", "Confidence"]) {
        const cell = element("th", "", label);
        cell.scope = "col";
        headings.append(cell);
      }
      head.append(headings);
      const body = element("tbody");
      for (const result of run.results) {
        const answer = result.answer;
        const line = element("tr");
        line.title = typeof result.instructions === "string" ? result.instructions : JSON.stringify(result.instructions);
        const question = element("th");
        question.scope = "row";
        question.append(element("span", "", targetLabel(result.target) ?? result.id));
        if (targetLabel(result.target)) question.append(element("small", "", result.id));
        const value = element("td");
        const selected =
          answer.type === "choice" ? answer.choice : answer.type === "noul" ? "Yes " + percentage(answer.noul) : Number(answer.score).toFixed(2) + " / " + result.maximum;
        value.append(element("strong", "", selected));
        if (answer.type === "choice" && typeof answer.probabilities?.[answer.choice] === "number")
          value.append(element("span", "history-number", " · " + percentage(answer.probabilities[answer.choice])));
        if (answer.type === "noul") value.append(element("small", "", "No " + percentage(1 - answer.noul)));
        line.append(question, value, element("td", "history-number", typeof answer.confidence === "number" ? percentage(answer.confidence) : "—"));
        body.append(line);
      }
      table.append(caption, head, body);
      row.append(table);
    } else row.append(element("p", "subtle", run.error ?? (run.status === "running" ? "Awaiting results…" : "No saved answers.")));
    container.append(row);
  }
}
