export type RejectedSdkResponse = {
  bodyText?: string;
  response?: Record<string, unknown>;
  actualCostUsd?: number;
  retryableProviderError: boolean;
};

export function shouldRetryRejectedProviderError(rejected: RejectedSdkResponse | undefined, retryCount: number): boolean {
  return Boolean(rejected?.retryableProviderError && retryCount >= 0 && retryCount < 2);
}

export function rejectedSdkResponse(error: unknown): RejectedSdkResponse | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (value.name !== "ResponseValidationError") return undefined;

  const bodyText = typeof value.body === "string" ? value.body : undefined;
  let response: Record<string, unknown> | undefined;
  if (bodyText) {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        response = parsed as Record<string, unknown>;
      }
    } catch {
      // Keep the exact body text available even when its JSON is malformed.
    }
  }
  if (!response && value.rawValue && typeof value.rawValue === "object" && !Array.isArray(value.rawValue)) {
    response = value.rawValue as Record<string, unknown>;
  }
  const usage = response?.usage;
  const actualCostUsd = usage && typeof usage === "object" && typeof (usage as Record<string, unknown>).cost === "number" ? (usage as Record<string, number>).cost : undefined;
  const apiError = response?.error && typeof response.error === "object" ? (response.error as Record<string, unknown>) : undefined;
  const metadata = apiError?.metadata && typeof apiError.metadata === "object" ? (apiError.metadata as Record<string, unknown>) : undefined;
  const retryableProviderError = metadata?.error_type === "provider_unavailable" || metadata?.error_type === "provider_overloaded";

  return { bodyText, response, actualCostUsd, retryableProviderError };
}
