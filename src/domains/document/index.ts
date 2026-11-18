export { discoverDocument, inspectSavedIteration, RetryableDiscoveryError } from "./discovery/operation.js";
export type { DiscoveryResult, DiscoveryTaskInput } from "./discovery/operation.js";
export { decodeCapturedSource, assertOutboundSourceMatches } from "./discovery/source.js";

export { loadRetainedSource } from "./decisions/semantic-input.js";
export { sourceComponent } from "./discovery/source.js";
export { readMarkdown, mapKeyCandidateIds } from "./blocks/read.js";
export { buildBlocks } from "./blocks/build.js";
export { runBlocksOperation } from "./blocks/operation.js";
export type { BlocksRunInput } from "./blocks/operation.js";
export type { BuiltLayout, ParsedDocument, ParsedItem } from "./blocks/types.js";
export { runAssociationOperation, newAssociationOperationId } from "./association/operation.js";
export type {
  AssociationRunInput,
  AssociationWorkflowInput,
  AssociationStage,
  AssociationStageExecutor,
} from "./association/operation.js";
export { exploratoryAssociationPolicy } from "./association/policy.js";
export { findEntityMentions } from "./association/mentions.js";
export type { MentionRecord, LocalEntity, AssociationLink, FoundSection, EntityContext } from "./association/types.js";
