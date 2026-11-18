import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogTransportTargets } from "./catalog-transport-targets.js";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";
import { prepareDecisionStage } from "../domains/document/decisions/stage.js";
import { assertExecutionCompatibility } from "../domains/document/decisions/retained-stage.js";
import * as questions from "../domains/document/decisions/questions.js";

test("local transport targets fit all nine complete sources and pin reconstructable whole passages", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap25-transport-"));
  const names = (await readdir("Resources/Lore")).filter((name) => /^0[1-9]-.*\.md$/.test(name)).sort();
  assert.equal(names.length, 9);
  for (const name of names) {
    const source = decodeCapturedSource(await readFile(join("Resources/Lore", name)));
    const { targets, evidence } = catalogTransportTargets(source, name);
    for (const component of Object.values(evidence))
      if (component) {
        assert.equal(source.bytes.subarray(component.start_byte, component.end_byte).toString("utf8"), component.text);
      }
    const prepared = await prepareDecisionStage({
      directory: join(root, name),
      operationId: "unit",
      stageId: "transport",
      discoveryDirectory: root,
      source,
      questions: targets,
      inputLimit: 32000,
      targetMode: name.startsWith("01") ? "single" : "batch",
      policy: {
        version: "unit",
        mode: "exploratory",
        contract_version: "decision-policy-v2",
        definitions_version: questions.definitionsVersion,
        probability_sum_tolerance: 0.02,
        confidence_tolerance: 0.02,
        calibration_evidence_hashes: [],
        rules: {
          title: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: true },
          textOrigin: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false },
        },
      },
    });
    assert.equal(prepared.manifest.config.rules_sha256, null);
    for (const batch of prepared.manifest.batches) {
      assert.equal((batch.request.state as Record<string, unknown>).complete_source, source.text);
      assert.equal(Object.hasOwn(batch.request.state as object, "entity_rules"), false);
      assert.ok(batch.input_upper_bound_tokens <= 32000);
    }
    await assertExecutionCompatibility(prepared.manifest);
    if (name.startsWith("03")) {
      assert.equal(targets[0]!.descriptor.question_kind, "title");
      assert.match(evidence.nearby.text, /^The Raven Queen did not often/);
      assert.match(evidence.following!.text, /Undeath is an atrocity/);
      assert.equal(prepared.manifest.batches[0]!.candidate_ids.length, 2);
    }
    if (name.startsWith("06")) {
      assert.match(evidence.block.text, /^After the events known/);
      assert.match(evidence.nearby.text, /^The Matron of Ravens/);
      assert.ok(evidence.block.end_byte < source.byteLength);
    }
  }
});
