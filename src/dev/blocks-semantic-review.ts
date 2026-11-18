import { resolve } from "node:path";

export type ReviewedDecision = { source_path: string; question_id: string; expected: string };
export type SemanticDecisionReport = {
  source_path: string;
  decisions?: Array<{ question_id: string; action: { label: string | null; status: string } }>;
};
export type SemanticOutcome = {
  question_id: string;
  expected: string;
  observed: string | null;
  status: string;
  result: "missing" | "matches_review" | "unresolved_visible" | "semantic_error";
};

export function evaluateReviewedDecisions(
  cases: readonly ReviewedDecision[],
  reports: readonly SemanticDecisionReport[],
): { outcomes: SemanticOutcome[]; failures: SemanticOutcome[] } {
  const outcomes = cases.map((reviewed): SemanticOutcome => {
    const sourceReport = reports.find((entry) => entry.source_path === resolve(reviewed.source_path));
    const decision = sourceReport?.decisions?.find((entry) => entry.question_id === reviewed.question_id);
    if (!decision)
      return {
        question_id: reviewed.question_id,
        expected: reviewed.expected,
        observed: null,
        status: "missing",
        result: "missing",
      };
    const action = decision.action;
    return {
      question_id: reviewed.question_id,
      expected: reviewed.expected,
      observed: action.label,
      status: action.status,
      result: action.status === "unresolved" ? "unresolved_visible" : action.label === reviewed.expected ? "matches_review" : "semantic_error",
    };
  });
  return {
    outcomes,
    failures: outcomes.filter((entry) => entry.result === "semantic_error" || entry.result === "missing"),
  };
}
