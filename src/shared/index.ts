export {
  SHARED_PROVIDER_ID,
  SHARED_ENDPOINT_FALLBACKS,
  SHARED_LOAD_ENDPOINT,
  SHARED_OAUTH_CLIENT,
  listSharedModels,
  getSharedModel,
  isClaudeModelId,
  readSharedRefresh,
  writeSharedRefresh,
  toSharedAuthEntry,
} from "./registry";
export type { SharedModelDefinition, SharedRefreshIdentity, SharedAuthEntry } from "./registry";

export {
  selectableAccounts,
  readPool,
  readPoolFromFile,
  addJitter,
  randomDelay,
  selectHybridAccount,
  sortByLruWithHealth,
  HealthScoreTracker,
  TokenBucketTracker,
  calculateBackoffMs,
  parseRateLimitReason,
  computeSoftQuotaCacheTtlMs,
  resolveQuotaGroup,
} from "./pool";
export type { SharedPoolAccount, SharedPoolSnapshot, AccountWithMetrics, RateLimitBackoffResult, RateLimitReason } from "./pool";

export {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT,
  GEMINI_CLI_ENDPOINT,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_SYSTEM_INSTRUCTION,
  getAntigravityVersion,
  setAntigravityVersion,
  getAntigravityHeaders,
  getRandomizedHeaders,
  GEMINI_CLI_HEADERS,
} from "../constants";
export type { HeaderStyle } from "../constants";

// Schema cleaning and tool declaration shapes: the host-specific request builders in
// `src/plugin/` own the Rules, and both the OpenCode plugin and the pi extension read them here so
// there is exactly one cleaning policy.
export {
  cleanJSONSchemaForAntigravity,
  injectParameterSignatures,
  applyToolPairingFixes,
  validateAndFixClaudeToolPairing,
} from "../plugin/request-helpers";

export {
  resolveModelWithTier,
  resolveModelForHeaderStyle,
  resolveAntigravityGemini35FlashBackendModel,
  resolveAntigravityGemini36FlashBackendModel,
  resolveAntigravityGemini37FlashBackendModel,
  resolveAntigravityGemini38FlashBackendModel,
} from "../plugin/transform/model-resolver";
export { isClaudeModel, isClaudeThinkingModel, configureClaudeToolConfig } from "../plugin/transform/claude";

export { authorizeAntigravity, exchangeAntigravity } from "../antigravity/oauth";
export type { AntigravityAuthorization, AntigravityTokenExchangeResult } from "../antigravity/oauth";

export {
  parseRefreshParts,
  formatRefreshParts,
  accessTokenExpired,
  isOAuthAuth,
} from "../plugin/auth";
export { AntigravityTokenRefreshError } from "../plugin/token";

export {
  isGenerativeLanguageRequest,
  prepareAntigravityRequest,
  transformAntigravityResponse,
  sanitizeRequestPayloadForAntigravity,
} from "../plugin/request";
export type { PrepareRequestOptions } from "../plugin/request";
