import api from './axios.js';

// ----- Auth -----
export const authApi = {
  // `data` is a FormData when a Student ID photo is attached, plain object otherwise.
  register: (data) =>
    api
      .post('/auth/register', data, data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined)
      .then((r) => r.data),
  login: (data) => api.post('/auth/login', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  changePassword: (data) => api.post('/auth/change-password', data).then((r) => r.data),
  publicSettings: () => api.get('/auth/settings').then((r) => r.data),
  sendOtp: (email) => api.post('/auth/send-otp', { email }).then((r) => r.data),
  verifyOtp: (data) => api.post('/auth/verify-otp', data).then((r) => r.data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (data) => api.post('/auth/reset-password', data).then((r) => r.data),
};

// ----- Messages (Faculty <-> Student direct messaging) -----
export const messageApi = {
  contacts: (search) => api.get('/messages/contacts', { params: { search: search || undefined } }).then((r) => r.data),
  conversations: () => api.get('/messages/conversations').then((r) => r.data),
  startConversation: (recipientId) => api.post('/messages/conversations', { recipientId }).then((r) => r.data),
  messages: (conversationId) => api.get(`/messages/conversations/${conversationId}/messages`).then((r) => r.data),
  send: (conversationId, text) => api.post(`/messages/conversations/${conversationId}/messages`, { text }).then((r) => r.data),
};

// ----- Email (University broadcast email system) -----
export const emailApi = {
  list: () => api.get('/emails').then((r) => r.data),
  get: (id) => api.get(`/emails/${id}`).then((r) => r.data),
  send: (data) => api.post('/emails/send', data).then((r) => r.data),
  contacts: (search) => api.get('/emails/contacts', { params: { search: search || undefined } }).then((r) => r.data),
};

// ----- Profile (self-service) -----
export const profileApi = {
  get: () => api.get('/profile').then((r) => r.data),
  update: (data) => api.patch('/profile', data).then((r) => r.data),
};

// ----- Bookmarks -----
// Folders and search live in this same API (see the server's
// bookmarkController) so the web client and the Android app cannot drift apart
// on how a bookmark is filed. `folderId` of 'default' means the built-in
// bucket every bookmark lands in until it is filed.
export const bookmarkApi = {
  list: (params) => api.get('/bookmarks', { params }).then((r) => r.data),
  add: (fileId, folderId) =>
    api.post(`/bookmarks/${fileId}`, folderId ? { folderId } : {}).then((r) => r.data),
  remove: (fileId) => api.delete(`/bookmarks/${fileId}`).then((r) => r.data),
  move: (fileId, folderId) => api.patch(`/bookmarks/${fileId}`, { folderId }).then((r) => r.data),
  folders: () => api.get('/bookmarks/folders').then((r) => r.data),
  createFolder: (name) => api.post('/bookmarks/folders', { name }).then((r) => r.data),
  renameFolder: (id, name) => api.patch(`/bookmarks/folders/${id}`, { name }).then((r) => r.data),
  removeFolder: (id) => api.delete(`/bookmarks/folders/${id}`).then((r) => r.data),
};

// ----- Departments -----
export const departmentApi = {
  list: () => api.get('/departments').then((r) => r.data),
  get: (id) => api.get(`/departments/${id}`).then((r) => r.data),
  courses: (id) => api.get(`/departments/${id}/courses`).then((r) => r.data),
  create: (data) => api.post('/departments', data).then((r) => r.data),
  update: (id, data) => api.put(`/departments/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/departments/${id}`).then((r) => r.data),
};

// ----- Courses -----
export const courseApi = {
  list: (params) => api.get('/courses', { params }).then((r) => r.data),
  // The signed-in user's own reachable courses (their department's courses
  // plus any they hold an active/approved CourseEnrollment for) — used by
  // Submit Material to scope a Student/"CR" to their own department/batch.
  mine: () => api.get('/courses/mine').then((r) => r.data),
  // The same set, split for the My Courses screen: `running` is the student's
  // own department's courses for the semester they are in, `other` is their
  // active retake/improvement/… enrolments (empty when there are none).
  mineGrouped: () => api.get('/courses/mine', { params: { grouped: true } }).then((r) => r.data),
  // The course page's batch selector: the most recent batches, each with its
  // content counts for this course. Derived server-side, never hardcoded.
  batches: (courseId) => api.get(`/courses/${courseId}/batches`).then((r) => r.data),
  get: (id) => api.get(`/courses/${id}`).then((r) => r.data),
  create: (data) => api.post('/courses', data).then((r) => r.data),
  update: (id, data) => api.put(`/courses/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/courses/${id}`).then((r) => r.data),
};

// ----- Batches -----
export const batchApi = {
  list: (params) => api.get('/batches', { params }).then((r) => r.data),
  create: (data) => api.post('/batches', data).then((r) => r.data),
  update: (id, data) => api.put(`/batches/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/batches/${id}`).then((r) => r.data),
};

// ----- Semesters -----
export const semesterApi = {
  list: () => api.get('/semesters').then((r) => r.data),
  create: (data) => api.post('/semesters', data).then((r) => r.data),
  update: (id, data) => api.put(`/semesters/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/semesters/${id}`).then((r) => r.data),
};

// ----- Categories -----
export const categoryApi = {
  list: () => api.get('/categories').then((r) => r.data),
  create: (data) => api.post('/categories', data).then((r) => r.data),
  update: (id, data) => api.put(`/categories/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/categories/${id}`).then((r) => r.data),
};

// ----- Chapters (Course -> Chapter) -----
export const chapterApi = {
  list: (params) => api.get('/chapters', { params }).then((r) => r.data),
  create: (data) => api.post('/chapters', data).then((r) => r.data),
  update: (id, data) => api.put(`/chapters/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/chapters/${id}`).then((r) => r.data),
};

// ----- Topics (Chapter -> Topic) -----
export const topicApi = {
  list: (params) => api.get('/topics', { params }).then((r) => r.data),
  create: (data) => api.post('/topics', data).then((r) => r.data),
  update: (id, data) => api.put(`/topics/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/topics/${id}`).then((r) => r.data),
};

// ----- Files (public browsing) -----
export const fileApi = {
  list: (params) => api.get('/files', { params }).then((r) => r.data),
  get: (id) => api.get(`/files/${id}`).then((r) => r.data),
  related: (id) => api.get(`/files/${id}/related`).then((r) => r.data),
  recent: (limit = 8) => api.get('/files/recent', { params: { limit } }).then((r) => r.data),
  popular: (limit = 8) => api.get('/files/popular', { params: { limit } }).then((r) => r.data),
  stats: () => api.get('/files/stats').then((r) => r.data),
  recordDownload: (id) => api.post(`/files/${id}/download`).then((r) => r.data),
  attachUploadcare: (payload) => api.post('/files/from-uploadcare', payload).then((r) => r.data),
  dashboard: (limit = 8) => api.get('/files/dashboard', { params: { limit } }).then((r) => r.data),
  // ----- Student submissions -----
  submit: (formData, onProgress) =>
    api
      .post('/files/submit', formData, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: onProgress })
      .then((r) => r.data),
  mine: (params) => api.get('/files/mine', { params }).then((r) => r.data),
};

// ----- Admin (own files only — enforced server-side) -----
export const adminApi = {
  myFiles: (params) => api.get('/admin/files', { params }).then((r) => r.data),
  upload: (formData, onProgress) =>
    api
      .post('/admin/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: onProgress,
      })
      .then((r) => r.data),
  updateFile: (id, data) => api.patch(`/admin/files/${id}`, data).then((r) => r.data),
  removeFile: (id) => api.delete(`/admin/files/${id}`).then((r) => r.data),
  bulkRemoveFiles: (ids) => api.post('/files/bulk-delete', { ids }).then((r) => r.data),
  getFileVersions: (id) => api.get(`/admin/files/${id}/versions`).then((r) => r.data),
  replaceFileVersion: (id, formData, onProgress) =>
    api
      .post(`/admin/files/${id}/versions`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: onProgress,
      })
      .then((r) => r.data),

  // ----- Student approvals -----
  pendingStudents: () => api.get('/admin/students/pending').then((r) => r.data),
  approveStudent: (id) => api.patch(`/admin/students/${id}/approve`).then((r) => r.data),
  rejectStudent: (id, reason) => api.patch(`/admin/students/${id}/reject`, { reason }).then((r) => r.data),
  // Fetched as a blob (not a plain <img src>) so the Authorization header is
  // actually sent — the endpoint is a private, authenticated proxy, not a
  // public/signed URL.
  studentIdPhotoUrl: (id) => api.get(`/admin/students/${id}/id-photo`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
};

// ----- Student ID verification (self-service, own request only) -----
export const studentIdApi = {
  status: () => api.get('/student-id/status').then((r) => r.data),
  // One endpoint for both a first-ever submission and a resubmission after
  // rejection — the server decides which it is from the account's current
  // approvalStatus.
  submit: (formData) =>
    api.post('/student-id/submit', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
};

// ----- Reviews (Admin / Super Admin / Faculty — pending student submissions) -----
export const reviewApi = {
  pending: () => api.get('/reviews/pending').then((r) => r.data),
  get: (id) => api.get(`/reviews/${id}`).then((r) => r.data),
  approve: (id, overrides) => api.patch(`/reviews/${id}/approve`, overrides || {}).then((r) => r.data),
  reject: (id) => api.delete(`/reviews/${id}`).then((r) => r.data),
};

// ----- Faculty's own scoped file management -----
export const facultyApi = {
  courses: () => api.get('/faculty/courses').then((r) => r.data),
  // My Courses: the same list, plus each course's per-faculty teachingStatus and
  // (with counts) its content totals. A separate method because `courses` above
  // is used directly as a React Query `queryFn` in several places, and React
  // Query passes its own context object as the first argument — giving that
  // method a `params` parameter would have sent queryKey/signal as query params.
  courseList: (params) => api.get('/faculty/courses', { params }).then((r) => r.data),
  // Activate/deactivate this course for the signed-in faculty member only.
  setCourseStatus: (courseId, status) =>
    api.patch(`/faculty/courses/${courseId}/status`, { status }).then((r) => r.data),
  files: (params) => api.get('/faculty/files', { params }).then((r) => r.data),
  upload: (formData, onProgress) =>
    api.post('/faculty/files', formData, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: onProgress }).then((r) => r.data),
  updateFile: (id, data) => api.patch(`/faculty/files/${id}`, data).then((r) => r.data),
  removeFile: (id) => api.delete(`/faculty/files/${id}`).then((r) => r.data),
  getFileVersions: (id) => api.get(`/faculty/files/${id}/versions`).then((r) => r.data),
  replaceFileVersion: (id, formData, onProgress) =>
    api
      .post(`/faculty/files/${id}/versions`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: onProgress })
      .then((r) => r.data),

  // ----- Student ID approvals (scoped to this faculty member's assigned Department/Course) -----
  pendingStudents: () => api.get('/faculty/students/pending').then((r) => r.data),
  approveStudent: (id) => api.patch(`/faculty/students/${id}/approve`).then((r) => r.data),
  rejectStudent: (id, reason) => api.patch(`/faculty/students/${id}/reject`, { reason }).then((r) => r.data),
  studentIdPhotoUrl: (id) => api.get(`/faculty/students/${id}/id-photo`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
};

// ----- Notices & Announcements -----
export const noticeApi = {
  list: () => api.get('/notices').then((r) => r.data),
  mine: () => api.get('/notices/mine').then((r) => r.data),
  create: (formData) => api.post('/notices', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) => api.patch(`/notices/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/notices/${id}`).then((r) => r.data),
};

// ----- Assignments -----
export const assignmentApi = {
  // Audience view (any authenticated role) + creator/management view (staff).
  list: () => api.get('/assignments').then((r) => r.data),
  mine: () => api.get('/assignments/mine').then((r) => r.data),
  // The course page's Assignments tab. These carry `{course, batch}`; the server
  // still applies the viewer's own audience filter, so they can only narrow.
  listInCourse: (params) => api.get('/assignments', { params }).then((r) => r.data),
  mineInCourse: (params) => api.get('/assignments/mine', { params }).then((r) => r.data),
  get: (id) => api.get(`/assignments/${id}`).then((r) => r.data),
  create: (formData) => api.post('/assignments', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) => api.patch(`/assignments/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/assignments/${id}`).then((r) => r.data),

  // Submissions
  submit: (id, formData) => api.post(`/assignments/${id}/submit`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  getMySubmission: (id) => api.get(`/assignments/${id}/my-submission`).then((r) => r.data),
  listMySubmissions: () => api.get('/assignments/my-submissions').then((r) => r.data),
  listSubmissions: (id) => api.get(`/assignments/${id}/submissions`).then((r) => r.data),
  grade: (id, submissionId, data) => api.patch(`/assignments/${id}/submissions/${submissionId}/grade`, data).then((r) => r.data),
  // Same blob + temporary-object-URL pattern as feedbackApi.export/
  // superAdminApi.exportUsers — the endpoint needs the Authorization header,
  // which a plain <a href> can't send.
  exportSubmissions: async (id) => {
    const res = await api.get(`/assignments/${id}/submissions/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'submissions-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ----- Course Enrollment (Regular + Additional: retake/extra/backlog/improvement/advance) -----
export const courseEnrollmentApi = {
  // Student-facing
  request: (data) => api.post('/course-enrollments/request', data).then((r) => r.data),
  my: () => api.get('/course-enrollments/my').then((r) => r.data),
  myActive: () => api.get('/course-enrollments/my/active').then((r) => r.data),
  myPending: () => api.get('/course-enrollments/my/pending').then((r) => r.data),

  // Staff
  list: (params) => api.get('/course-enrollments', { params }).then((r) => r.data),
  summary: (params) => api.get('/course-enrollments/summary', { params }).then((r) => r.data),
  get: (id) => api.get(`/course-enrollments/${id}`).then((r) => r.data),
  approve: (id) => api.patch(`/course-enrollments/${id}/approve`).then((r) => r.data),
  reject: (id, reason) => api.patch(`/course-enrollments/${id}/reject`, { reason }).then((r) => r.data),
  activate: (id) => api.patch(`/course-enrollments/${id}/activate`).then((r) => r.data),
  complete: (id) => api.patch(`/course-enrollments/${id}/complete`).then((r) => r.data),
  drop: (id) => api.patch(`/course-enrollments/${id}/drop`).then((r) => r.data),
  createDirect: (data) => api.post('/course-enrollments', data).then((r) => r.data),
  bulkEnrollRegular: (data) => api.post('/course-enrollments/bulk-regular', data).then((r) => r.data),
  remove: (id) => api.delete(`/course-enrollments/${id}`).then((r) => r.data),
};

// ----- Question bank -----
export const questionApi = {
  list: (params) => api.get('/questions', { params }).then((r) => r.data),
  // Fuzzy/typo-tolerant search with ranking + "did you mean" — same engine
  // as `list`'s own `q` param, shaped for a richer search UI.
  search: (params) => api.get('/questions/search', { params }).then((r) => r.data),
  suggestions: (params) => api.get('/questions/suggestions', { params }).then((r) => r.data),
  get: (id) => api.get(`/questions/${id}`).then((r) => r.data),
  create: (formData) => api.post('/questions', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) => api.patch(`/questions/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/questions/${id}`).then((r) => r.data),
  // Bulk-creates questions parsed from a .docx file — see
  // server/src/utils/docxQuestionParser.js for the markup it understands.
  importDocx: (formData) => api.post('/questions/import-docx', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
};

// ----- Quizzes -----
export const quizApi = {
  list: () => api.get('/quizzes').then((r) => r.data),
  mine: () => api.get('/quizzes/mine').then((r) => r.data),
  // The course page's Quizzes tab. Carry `{course, batch}`; the server still
  // applies the viewer's own audience filter, so they can only narrow.
  listInCourse: (params) => api.get('/quizzes', { params }).then((r) => r.data),
  mineInCourse: (params) => api.get('/quizzes/mine', { params }).then((r) => r.data),
  getForManage: (id) => api.get(`/quizzes/${id}/manage`).then((r) => r.data),
  create: (data) => api.post('/quizzes', data).then((r) => r.data),
  update: (id, data) => api.patch(`/quizzes/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/quizzes/${id}`).then((r) => r.data),

  start: (id) => api.post(`/quizzes/${id}/start`).then((r) => r.data),
  getAttempt: (id, attemptId) => api.get(`/quizzes/${id}/attempts/${attemptId}`).then((r) => r.data),
  saveAnswer: (id, attemptId, data) => api.patch(`/quizzes/${id}/attempts/${attemptId}/answer`, data).then((r) => r.data),
  submitAttempt: (id, attemptId) => api.post(`/quizzes/${id}/attempts/${attemptId}/submit`).then((r) => r.data),
  myAttempts: () => api.get('/quizzes/my-attempts').then((r) => r.data),

  listAttempts: (id) => api.get(`/quizzes/${id}/attempts`).then((r) => r.data),
  gradeAttempt: (id, attemptId, data) => api.patch(`/quizzes/${id}/attempts/${attemptId}/grade`, data).then((r) => r.data),
  analytics: (id) => api.get(`/quizzes/${id}/analytics`).then((r) => r.data),
  // Same blob + temporary-object-URL pattern as feedbackApi.export/
  // superAdminApi.exportUsers — the endpoint needs the Authorization header,
  // which a plain <a href> can't send.
  exportAttempts: async (id) => {
    const res = await api.get(`/quizzes/${id}/attempts/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attempts-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ----- Public Exams (guest-accessible, reuses the Quiz/QuizAttempt engine) -----
// `token` is the guestToken returned by `start` for an anonymous participant
// — sent as X-Attempt-Token so the server can verify attempt ownership
// without an account. Logged-in participants don't need it (the normal
// Authorization header already identifies them via `optionalAuth`).
function attemptHeaders(token) {
  return token ? { headers: { 'X-Attempt-Token': token } } : undefined;
}
export const publicExamApi = {
  landing: (slug) => api.get(`/public-exams/${slug}`).then((r) => r.data),
  verifyPassword: (slug, password) => api.post(`/public-exams/${slug}/password`, { password }).then((r) => r.data),
  start: (slug, payload) => api.post(`/public-exams/${slug}/start`, payload).then((r) => r.data),
  getAttempt: (slug, attemptId, token) => api.get(`/public-exams/${slug}/attempts/${attemptId}`, attemptHeaders(token)).then((r) => r.data),
  saveAnswer: (slug, attemptId, token, data) =>
    api.patch(`/public-exams/${slug}/attempts/${attemptId}/answer`, data, attemptHeaders(token)).then((r) => r.data),
  submitAttempt: (slug, attemptId, token) =>
    api.post(`/public-exams/${slug}/attempts/${attemptId}/submit`, {}, attemptHeaders(token)).then((r) => r.data),
  result: (slug, attemptId, token) => api.get(`/public-exams/${slug}/attempts/${attemptId}/result`, attemptHeaders(token)).then((r) => r.data),
};

// ----- Feedback -----
export const feedbackApi = {
  submit: (data) => api.post('/feedback', data).then((r) => r.data),
  list: (params) => api.get('/super-admin/feedback', { params }).then((r) => r.data),
  updateStatus: (id, status) => api.patch(`/super-admin/feedback/${id}/status`, { status }).then((r) => r.data),
  remove: (id) => api.delete(`/super-admin/feedback/${id}`).then((r) => r.data),
  // Fetched as a blob (the export endpoint needs the Authorization header,
  // which a plain <a href> can't send) then saved via a temporary object URL.
  export: async (params) => {
    const res = await api.get('/super-admin/feedback/export', { params, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feedback-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ----- Search -----
export const searchApi = {
  search: (params) => api.get('/search', { params }).then((r) => r.data),
  suggestions: (q) => api.get('/search/suggestions', { params: { q } }).then((r) => r.data),
};

// ----- Super Admin -----
export const superAdminApi = {
  listUsers: (params) => api.get('/super-admin/users', { params }).then((r) => r.data),
  // Same blob + temporary-object-URL pattern as feedbackApi.export — the
  // endpoint needs the Authorization header, which a plain <a href> can't send.
  exportUsers: async (params) => {
    const res = await api.get('/super-admin/users/export', { params, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getUser: (id) => api.get(`/super-admin/users/${id}`).then((r) => r.data),
  updateUserRole: (id, role) => api.patch(`/super-admin/users/${id}/role`, { role }).then((r) => r.data),
  updateUserStatus: (id, status) => api.patch(`/super-admin/users/${id}/status`, { status }).then((r) => r.data),
  // Manual Student ID approval override — student accounts only. Distinct
  // from adminApi.approveStudent/rejectStudent (queue-driven, pending-only);
  // this can move any student to any approvalStatus directly.
  updateUserApproval: (id, approvalStatus, reason) =>
    api.patch(`/super-admin/users/${id}/approval`, { approvalStatus, reason }).then((r) => r.data),
  updateUserProfile: (id, data) => api.patch(`/super-admin/users/${id}/profile`, data).then((r) => r.data),
  listFiles: (params) => api.get('/super-admin/files', { params }).then((r) => r.data),
  getFile: (id) => api.get(`/super-admin/files/${id}`).then((r) => r.data),
  removeFile: (id) => api.delete(`/super-admin/files/${id}`).then((r) => r.data),
  getSettings: () => api.get('/super-admin/settings').then((r) => r.data),
  updateSettings: (data) => api.patch('/super-admin/settings', data).then((r) => r.data),

  // ----- Faculty management -----
  listFaculty: (params) => api.get('/super-admin/faculty', { params }).then((r) => r.data),
  createFaculty: (data) => api.post('/super-admin/faculty', data).then((r) => r.data),
  updateFaculty: (id, data) => api.patch(`/super-admin/faculty/${id}`, data).then((r) => r.data),

  // ----- App-wide error/log viewer -----
  listLogs: (params) => api.get('/super-admin/logs', { params }).then((r) => r.data),
  getLog: (id) => api.get(`/super-admin/logs/${id}`).then((r) => r.data),
  deleteLog: (id) => api.delete(`/super-admin/logs/${id}`).then((r) => r.data),
  clearLogs: (level) => api.delete('/super-admin/logs', { params: level ? { level } : undefined }).then((r) => r.data),
};

// ----- Roles & Permissions (admin-tier roles like Admin, CR, ...) -----
export const roleApi = {
  list: () => api.get('/roles').then((r) => r.data),
  create: (data) => api.post('/roles', data).then((r) => r.data),
  updatePermissions: (key, permissions) => api.patch(`/roles/${key}`, { permissions }).then((r) => r.data),
  remove: (key) => api.delete(`/roles/${key}`).then((r) => r.data),
};

// ----- Analytics (super admin dashboard) -----
export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard').then((r) => r.data),
};

// ----- Notifications (self-service: in-app + PWA web push) -----
export const notificationApi = {
  list: (params) => api.get('/notifications', { params }).then((r) => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then((r) => r.data),
  markRead: (id) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then((r) => r.data),
  remove: (id) => api.delete(`/notifications/${id}`).then((r) => r.data),
  getPreferences: () => api.get('/notifications/preferences').then((r) => r.data),
  updatePreferences: (data) => api.put('/notifications/preferences', data).then((r) => r.data),
  vapidPublicKey: () => api.get('/notifications/vapid-public-key').then((r) => r.data),
  subscribePush: (subscription) => api.post('/notifications/subscribe', subscription).then((r) => r.data),
  unsubscribePush: (endpoint) => api.delete('/notifications/subscribe', { data: { endpoint } }).then((r) => r.data),
};

// ----- Notifications (Super Admin -> Notifications management) -----
export const adminNotificationApi = {
  stats: () => api.get('/admin/notifications/stats').then((r) => r.data),
  logs: (params) => api.get('/admin/notifications/logs', { params }).then((r) => r.data),
  send: (data) => api.post('/admin/notifications/send', data).then((r) => r.data),
};

// ----- Class routine & academic calendar -----
//
// Note what is NOT here: no caller-supplied department/batch/semester on any
// "my" call. The server derives the audience from the signed-in user's own
// record (academicEventService.audienceFilterFor), so a client cannot widen its
// own view by changing a query string — and the management listings are gated
// separately by the routine_*/exam_* permissions.
export const routineApi = {
  /** The caller's own schedule. `params`: { view: 'today'|'week'|'month', month, from, to } */
  mine: (params) => api.get('/routine/my', { params }).then((r) => r.data),
  today: () => api.get('/routine/today').then((r) => r.data),
  week: () => api.get('/routine/week').then((r) => r.data),
  month: (params) => api.get('/routine/month', { params }).then((r) => r.data),

  /** The SmartEventWidget's single call: current + next + whether anything is published. */
  currentNext: () => api.get('/events/my/current-next').then((r) => r.data),

  /** Lookups the routine form needs. */
  groups: () => api.get('/routine/groups').then((r) => r.data),
  facultyForCourse: (course) => api.get('/routine/faculty', { params: { course } }).then((r) => r.data),

  // Recurring rules (management).
  templates: (params) => api.get('/routine/templates', { params }).then((r) => r.data),
  create: (data) => api.post('/routine', data).then((r) => r.data),
  updateTemplate: (id, data) => api.patch(`/routine/templates/${id}`, data).then((r) => r.data),
  removeTemplate: (id) => api.delete(`/routine/templates/${id}`).then((r) => r.data),

  // Single occurrences (exceptions to a rule). `instances` is the management
  // listing — a dated timetable for a chosen scope, not an audience view.
  instances: (params) => api.get('/routine/instances', { params }).then((r) => r.data),
  updateInstance: (id, data) => api.patch(`/routine/instances/${id}`, data).then((r) => r.data),
  cancelInstance: (id, data) => api.post(`/routine/instances/${id}/cancel`, data || {}).then((r) => r.data),
  rescheduleInstance: (id, data) => api.post(`/routine/instances/${id}/reschedule`, data).then((r) => r.data),
  removeInstance: (id) => api.delete(`/routine/instances/${id}`).then((r) => r.data),
};

// ----- Academic events: exams, CTs, deadlines, general events -----
//
// /exams/* and /calendar/events are the same handlers on the server — an exam
// IS an AcademicEvent — so both are exposed here for readability rather than
// kept as two divergent paths.
export const calendarApi = {
  /** The caller's own calendar (classes + events), optional { type, from, to }. */
  mine: (params) => api.get('/calendar/my', { params }).then((r) => r.data),
  /** Assessments only (exams + deadlines). */
  myExams: () => api.get('/exams/my').then((r) => r.data),

  // Management.
  events: (params) => api.get('/calendar/events', { params }).then((r) => r.data),
  createEvent: (data) => api.post('/calendar/events', data).then((r) => r.data),
  updateEvent: (id, data) => api.patch(`/calendar/events/${id}`, data).then((r) => r.data),
  removeEvent: (id) => api.delete(`/calendar/events/${id}`).then((r) => r.data),
};
