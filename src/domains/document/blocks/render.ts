import type { BuiltLayout, Component, LayoutBlock } from "./types.js";

function fence(text: string) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map(([run]) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function componentView(component: Component): string[] {
  const marker = fence(component.text);
  return [`- ${component.role} [${component.start_byte}, ${component.end_byte}):`, `  ${marker}text`, component.text, `${marker}`];
}

function blockView(block: LayoutBlock): string[] {
  const lines = [`#### ${block.kind} · ${block.id}`];
  if (block.map_entry_number !== null) lines.push(`Map entry number: ${block.map_entry_number}`);
  for (const component of block.components) lines.push(...componentView(component));
  if (block.attribution) lines.push(`Attribution: ${block.attribution}`);
  return lines;
}

export function renderLayoutView(layout: BuiltLayout): string {
  const lines = [
    "# Source-local structure",
    "",
    `- Capability status: ${layout.capability_status}`,
    `- Full product status: ${layout.full_product_status}`,
    `- Source SHA-256: ${layout.source_sha256}`,
    `- Source byte length: ${layout.source_byte_length}`,
    `- Sections: ${layout.sections.length}; blocks: ${layout.blocks.length}; map keys: ${layout.map_keys.length}; place proposals: ${layout.place_proposals.length}`,
    "",
    "## Sections",
  ];
  for (const [index, section] of layout.sections.entries()) {
    lines.push("", `### ${index + 1}. ${section.kind} section · ${section.id}`, `Source bytes: [${section.start_byte}, ${section.end_byte})`);
    if (section.label_components.length) {
      lines.push("Labels:");
      for (const component of section.label_components) lines.push(...componentView(component));
    }
    for (const blockId of section.block_ids) {
      const block = layout.blocks.find((candidate) => candidate.id === blockId);
      if (block) lines.push("", ...blockView(block));
    }
    for (const [name, components] of [
      ["Notes", section.notes],
      ["Images", section.images],
      ["Context", section.context],
    ] as const) {
      if (!components.length) continue;
      lines.push("", `**${name}**`);
      for (const component of components) lines.push(...componentView(component));
    }
  }
  lines.push("", "## Map keys and place proposals");
  for (const map of layout.map_keys)
    lines.push(
      "",
      `- Map key ${map.id}: entries ${map.entries.map((entry) => entry.number).join(", ") || "(none)"}; image ${map.image ? `[${map.image.start_byte}, ${map.image.end_byte})` : "null"}${map.findings.length ? `; findings: ${map.findings.join("; ")}` : ""}`,
    );
  for (const proposal of layout.place_proposals)
    lines.push(
      `- Proposal ${proposal.id}: entry ${proposal.number}; ${JSON.stringify(proposal.display_label)}; source names ${JSON.stringify(proposal.source_names)}; qualification ${proposal.qualification_status}`,
    );
  lines.push("", "## Decisions");
  for (const decision of layout.decisions)
    lines.push(
      `- ${decision.question_id}: ${decision.action.status} ${JSON.stringify(decision.action.label)}; raw ${JSON.stringify(decision.raw_answer)}; repeat ${decision.repeat_response_reference ?? "null"}`,
    );
  lines.push("", "## Findings");
  if (layout.findings.length) for (const finding of layout.findings) lines.push(`- ${finding}`);
  else lines.push("- None.");
  return `${lines.join("\n")}\n`;
}
