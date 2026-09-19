import { env } from '../../config/env.js';
import { getSettings } from '../../models/Settings.js';

// The AI provider, model and the credit/export amounts: Database-backed settings
// where an admin can change them, the environment as the default. The API key is
// the one thing that stays in the environment and never reaches a client.

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function resolveAiConfig() {
  let settings = null;
  try {
    settings = await getSettings();
  } catch {
    // An unreadable settings document must not take the feature down — the env
    // defaults below still describe a working configuration.
    settings = null;
  }

  return {
    enabled: env.ai.enabled,
    provider: settings?.aiProvider || env.ai.provider,
    model: settings?.aiModel || env.ai.model,
    apiKey: env.ai.apiKey,
    baseUrl: env.ai.baseUrl,
    timeoutMs: env.ai.timeoutMs,
    maxTokens: env.ai.maxTokens,
    temperature: env.ai.temperature,

    creditsEnabled: env.ai.creditsEnabled && settings?.aiCreditsEnabled !== false,
    monthlyCredits: num(settings?.aiMonthlyCredits, env.ai.monthlyCredits),
    generationCost: num(settings?.aiGenerationCost, env.ai.generationCost),
    editCost: env.ai.editCost,
    rollover: env.ai.rollover,
    resetDay: env.ai.resetDay,
    exportExpirationHours: num(settings?.aiExportExpirationHours, env.ai.exportExpirationHours),

    maxSubjectChars: env.ai.maxSubjectChars,
    maxDetailsChars: env.ai.maxDetailsChars,
    maxAdditionalChars: env.ai.maxAdditionalChars,
    generateRateLimit: env.ai.generateRateLimit,
  };
}

export default { resolveAiConfig };
