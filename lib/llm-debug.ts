export function storesLlmDebugPayloads(): boolean {
  return ["1", "true", "yes"].includes(
    process.env.STORE_LLM_DEBUG_PAYLOADS?.trim().toLowerCase() ?? ""
  );
}
