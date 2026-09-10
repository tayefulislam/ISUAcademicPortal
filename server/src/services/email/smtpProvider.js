import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.email.smtp.host,
      port: env.email.smtp.port,
      secure: env.email.smtp.secure,
      auth: { user: env.email.smtp.user, pass: env.email.smtp.pass },
      // nodemailer's defaults (2 minutes for connection/greeting, indefinite
      // for the socket) mean a misconfigured host or a hosting provider that
      // blocks the SMTP port silently hangs for a very long time. Every
      // caller of sendEmail() now treats delivery as fire-and-forget, but
      // this still matters: it's what makes an actual mail outage fail fast
      // and get logged promptly instead of leaving a connection open for
      // minutes per attempt.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export function isSmtpConfigured() {
  return Boolean(env.email.smtp.host && env.email.smtp.user && env.email.smtp.pass);
}

export async function sendViaSmtp({ to, subject, html, text }) {
  const info = await getTransporter().sendMail({
    from: `"${env.email.fromName}" <${env.email.fromAddress}>`,
    to,
    subject,
    html,
    text,
  });
  return { provider: 'smtp', messageId: info.messageId };
}
