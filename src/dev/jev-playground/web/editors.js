export function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function field(label, input) {
  const wrapper = element("label");
  wrapper.append(element("span", "field-label", label), input);
  return wrapper;
}

function textEditor(value, onChange, structured = false) {
  const input = element("textarea");
  input.rows = 2;
  input.spellcheck = false;
  input.value = structured ? JSON.stringify(value, null, 2) : String(value ?? "");
  input.addEventListener("input", () => {
    try {
      const result = structured ? JSON.parse(input.value) : input.value;
      input.classList.remove("invalid-json");
      delete input.dataset.invalid;
      onChange(result);
    } catch {
      input.classList.add("invalid-json");
      input.dataset.invalid = "true";
      onChange(undefined, true);
    }
  });
  return input;
}

function renderTargets(container, question, change) {
  const details = element("details", "target-fields");
  details.open = true;
  details.append(element("summary", "", "Inputs for this question"));
  const grid = element("div", "target-grid");
  function renderGrid() {
    grid.replaceChildren();
    for (const [key, value] of Object.entries(question.target)) {
      const structured = typeof value !== "string";
      const wrapper = element("div", "target-field" + (structured || String(value).length > 90 ? " wide" : ""));
      const label = element("label", "", key);
      const input = textEditor(
        value,
        (next, invalid) => {
          if (!invalid) {
            question.target[key] = next;
            editor.value = JSON.stringify(question.target, null, 2);
            delete editor.dataset.invalid;
            editor.classList.remove("invalid-json");
          }
          change();
        },
        structured,
      );
      input.setAttribute("aria-label", question.id + " input " + key);
      if (structured) label.append(element("span", "", "JSON"));
      wrapper.append(label, input);
      grid.append(wrapper);
    }
  }
  details.append(grid);
  const raw = element("details");
  raw.append(element("summary", "subtle", "Edit the whole target object"));
  const editor = textEditor(
    question.target,
    (next, invalid) => {
      if (!invalid && next && typeof next === "object" && !Array.isArray(next)) {
        question.target = next;
        renderGrid();
      } else if (!invalid) {
        editor.dataset.invalid = "true";
        editor.classList.add("invalid-json");
      }
      change();
    },
    true,
  );
  editor.setAttribute("aria-label", question.id + " target JSON");
  raw.append(editor);
  renderGrid();
  details.append(raw);
  container.append(details);
}

function renderCriteria(container, question, change) {
  container.replaceChildren();
  const heading = element("div", "criteria-heading");
  heading.append(element("span", "", question.type === "score" ? "Score levels · start at 0" : "Answer choices"));
  const add = element("button", "icon-button", "+ Add");
  add.type = "button";
  add.hidden = question.type === "noul";
  heading.append(add);
  container.append(heading);
  const entries = question.type === "score" ? question.criteria.map((value, index) => [String(index), value]) : Object.entries(question.criteria);
  const keys = [];
  function update() {
    const unique = new Set(entries.map(([key]) => key));
    keys.forEach((input, index) => {
      const invalid = !entries[index][0].trim() || entries.filter(([key]) => key === entries[index][0]).length > 1;
      input.dataset.invalid = invalid ? "true" : "";
      input.classList.toggle("invalid-json", invalid);
    });
    if (unique.size === entries.length && entries.every(([key]) => key.trim())) {
      question.criteria = question.type === "score" ? entries.map(([, value]) => value) : Object.fromEntries(entries);
    }
    change();
  }
  entries.forEach((entry, index) => {
    const row = element("div", "criterion");
    const name = element("input");
    name.value = entry[0];
    name.setAttribute("aria-label", question.id + " option " + (index + 1));
    name.disabled = question.type !== "choice";
    name.addEventListener("input", () => {
      entry[0] = name.value;
      update();
    });
    keys.push(name);
    const wrapper = element("div");
    const structured = entry[1] !== null && typeof entry[1] !== "string";
    const description = textEditor(
      entry[1],
      (value, invalid) => {
        if (!invalid) entry[1] = value;
        update();
      },
      structured,
    );
    description.disabled = entry[1] === null;
    description.setAttribute("aria-label", question.id + " meaning for " + entry[0]);
    wrapper.append(description);
    if (question.type === "choice") {
      const label = element("label", "name-only");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = entry[1] === null;
      checkbox.addEventListener("change", () => {
        entry[1] = checkbox.checked ? null : description.value;
        description.disabled = checkbox.checked;
        update();
      });
      label.append(checkbox, document.createTextNode("Use the option name alone"));
      wrapper.append(label);
    }
    const remove = element("button", "icon-button", "×");
    remove.type = "button";
    remove.title = "Remove this option";
    remove.hidden = question.type === "noul";
    remove.addEventListener("click", () => {
      entries.splice(index, 1);
      question.criteria = question.type === "score" ? entries.map(([, value]) => value) : Object.fromEntries(entries);
      renderCriteria(container, question, change);
      change();
    });
    row.append(name, wrapper, remove);
    container.append(row);
  });
  add.addEventListener("click", () => {
    if (question.type === "score") question.criteria.push("Describe this level.");
    else {
      let key = "option_" + (entries.length + 1);
      while (Object.hasOwn(question.criteria, key)) key += "_new";
      question.criteria[key] = "Describe this answer.";
    }
    renderCriteria(container, question, change);
    change();
  });
}

export function renderQuestions(container, questions, options) {
  container.replaceChildren();
  questions.forEach((question, index) => {
    const card = element("details", "question-card");
    card.open = index === 0;
    const summary = element("summary");
    const title = element("span", "question-title");
    const name = element("span", "", question.id);
    title.append(element("span", "q-label", question.macro ?? String(index + 1).padStart(2, "0")), name);
    summary.append(title, element("span", "chevron", "⌄"));
    const content = element("div", "question-body");
    const controls = element("div", "question-controls");
    const id = element("input");
    id.value = question.id;
    id.setAttribute("aria-label", "Question " + (index + 1) + " ID");
    id.addEventListener("input", () => {
      question.id = id.value;
      name.textContent = id.value;
      options.change();
    });
    const type = element("select");
    type.setAttribute("aria-label", question.id + " answer type");
    for (const [value, label] of [
      ["choice", "Choice"],
      ["noul", "Yes / no"],
      ["score", "Score"],
    ]) {
      const option = element("option", "", label);
      option.value = value;
      type.append(option);
    }
    type.value = question.type;
    const remove = element("button", "icon-button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => options.remove(index));
    const duplicate = element("button", "icon-button", "Duplicate");
    duplicate.type = "button";
    duplicate.addEventListener("click", () => options.duplicate(index));
    controls.append(field("Question ID", id), field("Answer type", type), duplicate, remove);
    const instructions = textEditor(
      question.instructions,
      (next, invalid) => {
        if (!invalid) question.instructions = next;
        options.change();
      },
      typeof question.instructions !== "string",
    );
    instructions.classList.add("question-instructions");
    instructions.rows = 4;
    instructions.setAttribute("aria-label", question.id + " question wording");
    content.append(controls, field("Question wording · edit freely", instructions));
    renderTargets(content, question, options.change);
    const criteria = element("div");
    renderCriteria(criteria, question, options.change);
    type.addEventListener("change", () => {
      question.type = type.value;
      question.criteria =
        type.value === "score"
          ? ["Not at all", "Partly", "Fully"]
          : type.value === "noul"
            ? { true: "The answer is yes.", false: "The answer is no." }
            : { yes: "Yes.", no: "No.", unclear: "The content does not settle this." };
      renderCriteria(criteria, question, options.change);
      options.change();
    });
    content.append(criteria);
    card.append(summary, content);
    container.append(card);
  });
  if (!questions.length) container.append(element("p", "question-empty", "Add a macro or custom question to begin."));
}
