import { AI_ERROR, AiError } from './aiErrors.js';

// Google's Generative Language API — a different request/response shape from the
// OpenAI-compatible providers, so it gets its own implementation behind the same
// interface.
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** @returns {Promise<{content: string, model: string}>} */
export async function generateText({
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

  const root = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const url = `${root}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
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
    const content = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('')
      .trim();
    if (!content) throw new AiError(AI_ERROR.EMPTY_RESPONSE, 'The AI returned no text');
    return { content, model };
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

export default { generateText };
