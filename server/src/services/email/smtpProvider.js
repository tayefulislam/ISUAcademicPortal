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
