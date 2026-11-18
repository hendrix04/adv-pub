// Active Jev execution settings. Historical integrity checks retain their pinned assertions.
export const jevModel = "typesafe/jev-1.13";
export const jevProvider = "typesafe";
export const jevExecutionPolicy = {
  model: jevModel,
  provider: jevProvider,
  allowFallbacks: false,
  sdkRetries: "disabled",
  retries: 2,
  retryDelaySeconds: 30,
  maxConcurrentRequests: 10,
  requestTimeoutMs: 600_000,
  executionTimeout: "15m",
  scheduleTimeout: "4h",
} as const;

export const decisionRetryOptions = {
  retries: jevExecutionPolicy.retries,
  backoff: { factor: jevExecutionPolicy.retryDelaySeconds, maxSeconds: jevExecutionPolicy.retryDelaySeconds },
} as const;
