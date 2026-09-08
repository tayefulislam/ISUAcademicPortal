import { env } from '../../config/env.js';
import { sendViaSmtp, isSmtpConfigured } from './smtpProvider.js';
import { sendViaResend, isResendConfigured } from './resendProvider.js';
import { sendViaConsole } from './consoleProvider.js';

/**
 * Single entry point the rest of the app uses to send email. Controllers/
 * services must depend only on this module — never on a specific provider —
 * so the transport can change via EMAIL_PROVIDER without touching call
 * sites. Falls back to logging the email to the console whenever the
 * configured provider is missing its required credentials, so OTP/reset/
 * notification flows never hard-crash for lack of mail config.
 *
 * @param {{to: string|string[], subject: string, html: string, text?: string}} message
 */
export async function sendEmail({ to, subject, html, text }) {
  const provider = env.email.provider;

  if (provider === 'smtp' && isSmtpConfigured()) {
    return sendViaSmtp({ to, subject, html, text });
  }
  if (provider === 'resend' && isResendConfigured()) {
    return sendViaResend({ to, subject, html, text });
  }

  if (provider !== 'console') {
    console.warn(`[email] EMAIL_PROVIDER="${provider}" is not fully configured — falling back to console logging.`);
  }
  return sendViaConsole({ to, subject, html, text });
}
