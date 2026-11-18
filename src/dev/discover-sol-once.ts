if (process.env.ADV_PUB_DISCOVERY_MODEL) {
  throw new Error("The dedicated Sol test launcher does not accept a model override");
}
process.env.ADV_PUB_DISCOVERY_MODEL = "openai/gpt-6.1-sol";
process.env.ADV_PUB_SINGLE_SOURCE_SOL_FORECAST = "1";
await import("./discover-document.js");
