import { AI_ERROR, AiError } from './aiErrors.js';

// DeepSeek, OpenAI and OpenRouter all speak the same Chat Completions shape, so
// one implementation serves all three — only the base URL (and the key) differ.
const BASE_URLS = {
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function baseUrlFor(provider, override) {
  if (override) return String(override).replace(/\/$/, '');
  return BASE_URLS[provider] || BASE_URLS.deepseek;
}

/**
 * One completion. Throws a typed {@link AiError} rather than returning partial
 * text, so a caller can refund a reserved credit and show a real message.
 *
 * @returns {Promise<{content: string, model: string}>}
 */
export async function generateText({
  provider,
  model,
  apiKey,
  baseUrl,
  system,
  user,
  temperature,
  maxTokens,
  timeoutMs,
}) {
  if (!apiKey) throw new AiError(AI_ERROR.NOT_CONFIGURED, 'No AI API key is configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrlFor(provider, baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter asks for these; harmless to the others.
        'HTTP-Referer': 'https://isu.ac.bd',
        'X-Title': 'ISU Academic Portal',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new AiError(AI_ERROR.RATE_LIMITED, 'The AI service is rate limited');
    }
    if (!response.ok) {
      throw new AiError(AI_ERROR.UNAVAILABLE, `The AI service returned ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) {
      throw new AiError(AI_ERROR.EMPTY_RESPONSE, 'The AI returned no text');
    }
    return { content: String(content).trim(), model: data?.model || model };
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error?.name === 'AbortError') {
      throw new AiError(AI_ERROR.TIMEOUT, 'The AI request timed out');
    }
    throw new AiError(AI_ERROR.UNAVAILABLE, 'The AI service could not be reached');
  } finally {
    clearTimeout(timer);
  }
}

export default { generateText, baseUrlFor };
