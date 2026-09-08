// Fallback transport used whenever no real provider is configured (or its
// credentials are missing) — logs the email instead of sending it, so OTP/
// reset/notification flows stay fully testable without live mail creds.
export async function sendViaConsole({ to, subject, html, text }) {
  console.log('\n===== [EMAIL:console] =====');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log(text || html);
  console.log('============================\n');
  return { provider: 'console', messageId: `console-${Date.now()}` };
}
