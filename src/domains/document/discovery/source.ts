import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export type CapturedSource = {
  bytes: Buffer;
  byteLength: number;
  sha256: string;
  text: string;
};

export function decodeCapturedSource(bytes: Uint8Array): CapturedSource {
  const original = Buffer.from(bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original);
  } catch {
    throw new Error("Source is not valid UTF-8");
  }

  if (!Buffer.from(text, "utf8").equals(original)) {
    throw new Error("UTF-8 source does not round-trip to its original bytes");
  }

  return {
    bytes: original,
    byteLength: original.byteLength,
    sha256: createHash("sha256").update(original).digest("hex"),
    text,
  };
}

export function assertOutboundSourceMatches(outboundText: string, captured: CapturedSource, retainedBytes: Uint8Array): void {
  const outboundBytes = Buffer.from(outboundText, "utf8");
  if (
    !outboundBytes.equals(captured.bytes) ||
    !Buffer.from(retainedBytes).equals(captured.bytes) ||
    outboundBytes.byteLength !== captured.byteLength ||
    createHash("sha256").update(outboundBytes).digest("hex") !== captured.sha256
  ) {
    throw new Error("Outbound complete source differs from the retained UTF-8 source");
  }
}

/** Parser and regex offsets are UTF-16; evidence always addresses the original UTF-8 bytes. */
export function sourceComponent(source: CapturedSource, start: number, end: number) {
  for (const offset of [start, end]) {
    if (!Number.isInteger(offset) || offset < 0 || offset > source.text.length) throw new Error("Invalid source offset");
    const previous = source.text.charCodeAt(offset - 1);
    const next = source.text.charCodeAt(offset);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) throw new Error("Offset splits a surrogate pair");
  }
  if (end < start) throw new Error("Reversed source range");
  const start_byte = Buffer.byteLength(source.text.slice(0, start), "utf8");
  const end_byte = Buffer.byteLength(source.text.slice(0, end), "utf8");
  const text = source.text.slice(start, end);
  if (!source.bytes.subarray(start_byte, end_byte).equals(Buffer.from(text))) throw new Error("Source span does not reconstruct original bytes");
  return { start_byte, end_byte, text };
}
