import { element } from "./editors.js";

export function populateCatalog(bootstrap, { $, loadExperiment, loadMacro }) {
  for (const item of bootstrap.cases) {
    const button = element("button", "preset", item.title);
    button.dataset.case = item.id;
    button.title = item.description;
    button.addEventListener("click", () => loadExperiment(item));
    $("presets").append(button);
  }
  const groups = new Map();
  for (const macro of bootstrap.macros) {
    if (!groups.has(macro.stage)) {
      const group = element("optgroup");
      group.label = macro.stage;
      groups.set(macro.stage, group);
      $("macro").append(group);
    }
    const option = element("option", "", macro.id + " · " + macro.title);
    option.value = macro.id;
    groups.get(macro.stage).append(option);
    const card = element("button", "catalog-item");
    const text = element("span");
    text.append(element("strong", "", macro.title), element("small", "", macro.stage + " · " + macro.question.type));
    card.append(element("span", "q-label", macro.id), text);
    card.addEventListener("click", () => loadMacro(macro.id));
    $("catalog-grid").append(card);
  }
  $("macro").value = "Q05";
  const describeMacro = () => {
    const macro = bootstrap.macros.find((item) => item.id === $("macro").value);
    $("macro-description").textContent = macro.status + " · " + macro.version + ". Load starts a sample; Add keeps your context.";
  };
  $("macro").addEventListener("change", describeMacro);
  describeMacro();
  for (const item of bootstrap.documents) {
    const option = element("option", "", item.id.slice(0, 2) + " · " + item.title);
    option.value = item.id;
    $("document").append(option);
  }
}
