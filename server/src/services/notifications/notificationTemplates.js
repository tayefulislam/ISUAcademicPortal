// One entry per NOTIFICATION_TYPES key — `title`/`message`/`url` are
// functions of `vars` so callers just pass plain data (spec §21's
// "{teacherName} uploaded {fileName}" style, without literal string
// templating/injection risk since these are real JS template strings).
// Adding a new notification type later is: add a key to Notification.js's
// NOTIFICATION_TYPES + one entry here.

export const TEMPLATES = {
  FILE_UPLOADED: {
    title: () => "New Course Material",
    message: (v) =>
      `${v.actorName} uploaded "${v.fileName}"${v.courseName ? ` in ${v.courseName}` : ""}`,
    url: (v) => `/files/${v.fileId}`,
  },
  FILE_UPDATED: {
    title: () => "Course Material Updated",
    message: (v) =>
      `"${v.fileName}" was updated${v.courseName ? ` in ${v.courseName}` : ""}`,
    url: (v) => `/files/${v.fileId}`,
  },
  COURSE_MATERIAL: {
    title: () => "New Course Material",
    message: (v) =>
      `${v.actorName} uploaded "${v.fileName}"${v.courseName ? ` — ${v.courseName}` : ""}`,
    url: (v) => `/files/${v.fileId}`,
  },
  ASSIGNMENT_CREATED: {
    title: () => "New Assignment",
    message: (v) =>
      `${v.title} has been published${v.deadline ? `. Due ${v.deadline}` : ""}`,
    url: (v) => `/student/assignments/${v.assignmentId}`,
  },
  ASSIGNMENT_UPDATED: {
    title: () => "Assignment Updated",
    message: (v) => `${v.title} has been updated`,
    url: (v) => `/student/assignments/${v.assignmentId}`,
  },
  ASSIGNMENT_SUBMITTED: {
    title: () => "New Submission",
    message: (v) => `${v.studentName} submitted "${v.title}"`,
    url: (v) => `/faculty/assignments/${v.assignmentId}/submissions`,
  },
  ASSIGNMENT_RESULT: {
    title: () => "Assignment Result Published",
    message: (v) =>
      `Your result for "${v.title}" is now available (${v.marks}/${v.maxMarks})`,
    url: (v) => `/student/assignments/${v.assignmentId}`,
  },
  EXAM_CREATED: {
    title: () => "New Exam",
    message: (v) =>
      `${v.title} has been published${v.startAt ? `. Starts ${v.startAt}` : ""}`,
    // A quiz-backed exam links to its own screen; a scheduled exam/CT has no
    // quiz behind it, so it falls back to the calendar (spec: the notification
    // should link straight to the event).
    url: (v) => (v.quizId ? `/student/exams/${v.quizId}` : '/routine'),
  },
  EXAM_UPDATED: {
    title: () => "Exam Updated",
    message: (v) => `${v.title} has been updated`,
    url: (v) => (v.quizId ? `/student/exams/${v.quizId}` : '/routine'),
  },
  EXAM_REMINDER: {
    title: () => "Exam Reminder",
    message: (v) => `Your ${v.title} exam starts soon`,
    // A quiz-backed exam links to its own screen; a scheduled exam/CT has no quiz
    // behind it (`runExamReminders` passes no quizId), so it falls back to the
    // calendar rather than rendering "/student/exams/undefined".
    url: (v) => (v.quizId ? `/student/exams/${v.quizId}` : '/routine'),
  },
  // Class routine reminders. `when` is the Dhaka-formatted window ("10:00 AM"),
  // formatted by the sender so every channel shows the institution's clock
  // rather than the reader's.
  CLASS_REMINDER: {
    title: () => "Class Reminder",
    message: (v) =>
      `${v.courseCode || v.courseName || "Your class"} starts in ${v.minutesBefore} minutes${v.when ? ` at ${v.when}` : ""}${v.room ? ` — Room ${v.room}` : ""}`,
    url: () => "/routine",
  },
  CLASS_STARTING: {
    title: () => "Class Starting Now",
    message: (v) =>
      `${v.courseCode || v.courseName || "Your class"} is starting now${v.room ? ` — Room ${v.room}` : ""}`,
    url: () => "/routine",
  },
  CLASS_CANCELLED: {
    title: () => "Class Cancelled",
    message: (v) =>
      `${v.courseCode || v.courseName || "Your class"}${v.when ? ` at ${v.when}` : ""} has been cancelled.`,
    url: () => "/routine",
  },
  CLASS_RESCHEDULED: {
    title: () => "Class Rescheduled",
    message: (v) =>
      `${v.courseCode || v.courseName || "Your class"} has moved${v.when ? ` to ${v.when}` : ""}${v.room ? ` — Room ${v.room}` : ""}.`,
    url: () => "/routine",
  },
  CLASS_ROOM_CHANGED: {
    title: () => "Room Changed",
    message: (v) =>
      `${v.courseCode || v.courseName || "Your class"}${v.when ? ` at ${v.when}` : ""}: Room ${v.fromRoom} → Room ${v.toRoom}`,
    url: () => "/routine",
  },
  EXAM_RESULT: {
    title: () => "Result Published",
    message: (v) => `Your ${v.title} result is now available`,
    url: (v) => `/student/results/${v.attemptId}`,
  },
  NOTICE_CREATED: {
    title: () => "New Notice",
    message: (v) => v.title,
    url: (v) => `/student/notices/${v.noticeId}`,
  },
  NOTICE_UPDATED: {
    title: () => "Notice Updated",
    message: (v) => v.title,
    url: (v) => `/student/notices/${v.noticeId}`,
  },
  GRADE_PUBLISHED: {
    title: () => "Grade Published",
    message: (v) => `Your grade for "${v.title}" is now available`,
    url: (v) => v.url || "/student/assignments",
  },
  RESULT_PUBLISHED: {
    title: () => "Result Published",
    message: (v) => `Your result for "${v.title}" is now available`,
    url: (v) => v.url || "/student/results",
  },
  MESSAGE_RECEIVED: {
    title: (v) => `New message from ${v.senderName}`,
    message: (v) => v.preview,
    url: (v) => `/messages/${v.conversationId}`,
  },
  COURSE_ENROLLED: {
    title: () => "Enrollment Approved",
    message: (v) => `You're now enrolled in ${v.courseName}`,
    url: (v) => `/student/courses/${v.courseId}`,
  },
  COURSE_UPDATED: {
    title: () => "Course Updated",
    message: (v) => `${v.courseName} was updated`,
    url: (v) => `/student/courses/${v.courseId}`,
  },
  JOIN_REQUEST: {
    title: () => "New Enrollment Request",
    message: (v) => `${v.studentName} requested to join ${v.courseName}`,
    url: () => `/faculty/enrollments`,
  },
  JOIN_REQUEST_APPROVED: {
    title: () => "Enrollment Request Approved",
    message: (v) => `Your request to join ${v.courseName} was approved`,
    url: (v) => `/student/courses/${v.courseId}`,
  },
  STUDENT_ID_APPROVED: {
    title: () => "Student ID Approved",
    message: () =>
      "Your Student ID has been verified. You now have full access to your dashboard.",
    url: () => "/dashboard",
  },
  STUDENT_ID_REJECTED: {
    title: () => "Student ID Rejected",
    message: (v) =>
      v.reason
        ? `Your Student ID was rejected: ${v.reason}`
        : "Your Student ID was rejected. Please resubmit.",
    url: () => "/pending-approval",
  },
  SYSTEM: {
    title: (v) => v.title || "System Notification",
    message: (v) => v.message || "",
    url: (v) => v.url || "/notifications",
  },
};

export function renderTemplate(type, vars = {}) {
  const t = TEMPLATES[type];
  if (!t) throw new Error(`Unknown notification type: ${type}`);
  return { title: t.title(vars), message: t.message(vars), url: t.url(vars) };
}
