import { env } from '../../config/env.js';

export function isResendConfigured() {
  return Boolean(env.email.resend.apiKey);
}

export async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.email.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${env.email.fromName} <${env.email.fromAddress}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || `Resend API error (${res.status})`);
  }
  return { provider: 'resend', messageId: body.id };
}
