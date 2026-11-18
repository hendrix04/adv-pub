import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeCapturedSource } from "./source.js";
import { inspectEvidence } from "./response.js";
import { chargeBound, chargeFromUsageOrEstimate } from "./budget.js";

test("source decoding preserves exact UTF-8 bytes and hashes those bytes", () => {
  const bytes = Buffer.from("\uFEFF# Title\r\nLa drágona Ala.", "utf8");
  const captured = decodeCapturedSource(bytes);

  assert.equal(captured.byteLength, bytes.length);
  assert.equal(captured.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(Buffer.from(captured.text, "utf8"), bytes);
});

test("source decoding rejects invalid UTF-8 instead of replacing bytes", () => {
  assert.throws(() => decodeCapturedSource(Buffer.from([0x23, 0xff, 0x0a])), /UTF-8/);
});

test("evidence is ambiguous until source context selects one quote", () => {
  const source = "Ala met the Council. Later Ala met the Council.";
  const unresolved = inspectEvidence(source, [{ key: "ev1", quote: "Ala", before: "", after: "" }]);
  const resolved = inspectEvidence(source, [{ key: "ev1", quote: "Ala", before: "Later ", after: " met" }]);

  assert.equal(unresolved[0]?.status, "ambiguous");
  assert.equal(resolved[0]?.status, "verified");
  assert.equal(resolved[0]?.start_byte, Buffer.byteLength("Ala met the Council. Later ", "utf8"));
});

test("a unique quote does not hide incorrect supplied context anchors", () => {
  const result = inspectEvidence("Before quote after.", [{ key: "ev1", quote: "quote", before: "Wrong ", after: " after" }]);
  assert.equal(result[0]?.status, "anchor_mismatch");
  assert.equal(result[0]?.start_byte, 7);
});

test("charge bounds use full uncached input, output allowance, and current rates", () => {
  assert.ok(
    Math.abs(
      chargeBound({
        inputBytes: 100,
        outputTokenLimit: 1_000,
        promptPricePerToken: 0.00000005,
        inputCacheWritePricePerToken: 0.0000000625,
        completionPricePerToken: 0.00000025,
        promptThreshold: 272_000,
        overThresholdPromptPricePerToken: 0.0000001,
        overThresholdInputCacheWritePricePerToken: 0.000000125,
        overThresholdCompletionPricePerToken: 0.000000375,
      }) - 0.00028825,
    ) < 1e-12,
  );
});

test("run accounting defaults to one cent and uses OpenRouter usage cost when reported", () => {
  assert.equal(chargeFromUsageOrEstimate(undefined), 0.01);
  assert.equal(chargeFromUsageOrEstimate(0.00365675), 0.00365675);
});
