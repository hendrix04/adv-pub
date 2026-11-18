import { sourceComponent, type CapturedSource } from "../domains/document/discovery/source.js";
import * as questions from "../domains/document/decisions/questions.js";

/** Small source-backed transport fixtures, not capability parsing or layout planning. */
export function catalogTransportTargets(source: CapturedSource, name: string) {
  const text = source.text;
  // The fixtures pin prose passages and their whole adjacent passages.
  // No length cap, summary, or partial paragraph is used.
  const anchors: Record<string, string> = {
    "01": "The Unified Church grew",
    "02": "Common origins of the peoples",
    "03": "By 1515",
    "04": "*Tap-tap-tap-tap-tap",
    "05": "**Beic,",
    "06": "After the events known",
    "07": "*A lecture",
    "08": "It feels worthwhile",
    "09": "**Icewind Dale**",
  };
  const anchor = anchors[name.slice(0, 2)];
  const start = anchor ? text.indexOf(anchor) : -1;
  if (start < 0) throw new Error("Transport fixture has no passage");
  const end = text.indexOf("\n\n", start);
  const block = sourceComponent(source, start, end < 0 ? text.length : end);
  const nextStart = name.startsWith("03-") ? text.indexOf("The Raven Queen did not often") : end < 0 ? text.length : end + 2;
  if (nextStart < 0) throw new Error("Pinned nearby passage missing");
  const nextEnd = text.indexOf("\n\n", nextStart);
  const nearby = sourceComponent(source, nextStart, nextEnd < 0 ? text.length : nextEnd);
  const targets = [
    questions.textOrigin({
      id: "origin",
      target: { block: block.text, nearby_blocks: nearby.text ? [nearby.text] : [] },
    }),
  ];
  const evidence = {
    block,
    nearby,
    title: null as ReturnType<typeof sourceComponent> | null,
    following: null as ReturnType<typeof sourceComponent> | null,
  };
  if (name.startsWith("03-")) {
    const titleText = "**Commandments of the Matron of Ravens**";
    const titleStart = text.indexOf(titleText);
    if (titleStart < 0) throw new Error("Pinned title transport fixture missing");
    const followingStart = titleStart + titleText.length + 1;
    const followingEnd = text.indexOf("\n\n", followingStart);
    const title = sourceComponent(source, titleStart, titleStart + titleText.length);
    const following = sourceComponent(source, followingStart, followingEnd < 0 ? text.length : followingEnd);
    const sectionStart = text.lastIndexOf("#TheRavenQueen ", titleStart);
    const sectionEnd = text.indexOf("#Shadow\n", followingStart);
    if (sectionStart < 0 || sectionEnd < 0) throw new Error("Pinned title section labels missing");
    const section = sourceComponent(source, sectionStart, sectionEnd);
    targets.unshift(
      questions.title({
        id: "title",
        target: {
          line: title.text,
          following_text: following.text,
          section_limits: [section.start_byte, section.end_byte],
        },
      }),
    );
    evidence.title = title;
    evidence.following = following;
  }
  return { targets, evidence };
}
