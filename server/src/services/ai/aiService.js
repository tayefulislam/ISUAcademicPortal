import { env } from '../../config/env.js';
import { AI_ERROR, AiError } from './aiErrors.js';
import { resolveAiConfig } from './aiConfig.js';
import { generateText as openAiCompatible } from './openAiCompatibleProvider.js';
import { generateText as geminiGenerate } from './geminiProvider.js';

// The one entry point every AI call goes through. It resolves the configured
// provider and model, dispatches to that provider, and returns plain text — the
// caller never sees a provider, a model or a key.

/** True when an AI call could be attempted at all (used for admin diagnostics). */
export function isAiConfigured() {
  return Boolean(env.ai.enabled && env.ai.apiKey);
}

/**
 * @param {{system: string, user: string, maxTokens?: number}} args
 * @returns {Promise<{content: string, provider: string, model: string}>}
 */
export async function generateText({ system, user, maxTokens }) {
  const config = await resolveAiConfig();
  if (!config.enabled) {
    throw new AiError(AI_ERROR.NOT_CONFIGURED, 'AI generation is turned off');
  }
  if (!config.apiKey) {
    throw new AiError(AI_ERROR.NOT_CONFIGURED, 'AI is not configured on this server');
  }

  const args = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    system,
    user,
    temperature: config.temperature,
    maxTokens: maxTokens || config.maxTokens,
    timeoutMs: config.timeoutMs,
  };

  const result = config.provider === 'gemini'
    ? await geminiGenerate(args)
    : await openAiCompatible(args);

  return { content: result.content, provider: config.provider, model: result.model || config.model };
}

export default { generateText, isAiConfigured };
