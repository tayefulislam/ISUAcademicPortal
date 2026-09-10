// Minimal shared HTML wrapper — this app has no email design system, so a
// single inline-styled shell is enough for OTP/reset/broadcast mail.
function wrap(title, bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1e293b">
    <h2 style="color:#4338ca;margin:0 0 16px">${title}</h2>
    ${bodyHtml}
    <p style="margin-top:32px;font-size:12px;color:#94a3b8">ISU Academic Portal — automated message, please do not reply.</p>
  </div>`;
}

export function otpEmail(code) {
  return {
    subject: 'Your verification code',
    html: wrap(
      'Verify your email',
      `<p>Your one-time verification code is:</p>
       <p style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#1e293b">${code}</p>
       <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`
    ),
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
  };
}

export function passwordResetEmail(resetUrl) {
  return {
    subject: 'Reset your password',
    html: wrap(
      'Reset your password',
      `<p>We received a request to reset your password. Click the button below to choose a new one:</p>
       <p><a href="${resetUrl}" style="display:inline-block;background:#4338ca;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Reset Password</a></p>
       <p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
       <p style="font-size:12px;color:#64748b">Or paste this link into your browser: ${resetUrl}</p>`
    ),
    text: `Reset your password: ${resetUrl} (expires in 30 minutes)`,
  };
}

export function enrollmentApprovedEmail(courseName, courseCode, enrollmentType) {
  return {
    subject: `Your ${courseCode} enrollment was approved`,
    html: wrap(
      'Enrollment approved',
      `<p>Your <strong>${enrollmentType}</strong> enrollment request for <strong>${courseName} (${courseCode})</strong> has been approved. You now have access to its materials, assignments, and quizzes.</p>`
    ),
    text: `Your ${enrollmentType} enrollment for ${courseName} (${courseCode}) has been approved.`,
  };
}

export function enrollmentRejectedEmail(courseName, courseCode, enrollmentType, reason) {
  return {
    subject: `Your ${courseCode} enrollment was not approved`,
    html: wrap(
      'Enrollment not approved',
      `<p>Your <strong>${enrollmentType}</strong> enrollment request for <strong>${courseName} (${courseCode})</strong> was not approved.</p>
       ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}`
    ),
    text: `Your ${enrollmentType} enrollment request for ${courseName} (${courseCode}) was not approved.${reason ? ` Reason: ${reason}` : ''}`,
  };
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function enrollmentRequestedEmail(studentName, courseName, courseCode, enrollmentType) {
  const safeName = escapeHtml(studentName);
  return {
    subject: `New ${enrollmentType} enrollment request — ${courseCode}`,
    html: wrap(
      'New enrollment request',
      `<p><strong>${safeName}</strong> has requested a <strong>${enrollmentType}</strong> enrollment in <strong>${courseName} (${courseCode})</strong>.</p>
       <p>Review it from your Course Enrollment queue.</p>`
    ),
    text: `${studentName} has requested a ${enrollmentType} enrollment in ${courseName} (${courseCode}). Review it from your Course Enrollment queue.`,
  };
}

export function broadcastEmail(subject, bodyText) {
  return {
    subject,
    html: wrap(escapeHtml(subject), `<div style="white-space:pre-wrap">${escapeHtml(bodyText)}</div>`),
    text: bodyText,
  };
}
