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
};

// ----- Profile (self-service) -----
export const profileApi = {
  get: () => api.get('/profile').then((r) => r.data),
  update: (data) => api.patch('/profile', data).then((r) => r.data),
};

// ----- Bookmarks -----
export const bookmarkApi = {
  list: () => api.get('/bookmarks').then((r) => r.data),
  add: (fileId) => api.post(`/bookmarks/${fileId}`).then((r) => r.data),
  remove: (fileId) => api.delete(`/bookmarks/${fileId}`).then((r) => r.data),
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
  rejectStudent: (id) => api.patch(`/admin/students/${id}/reject`).then((r) => r.data),
  // Fetched as a blob (not a plain <img src>) so the Authorization header is
  // actually sent — the endpoint is a private, authenticated proxy, not a
  // public/signed URL.
  studentIdPhotoUrl: (id) => api.get(`/admin/students/${id}/id-photo`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
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
  files: (params) => api.get('/faculty/files', { params }).then((r) => r.data),
  updateFile: (id, data) => api.patch(`/faculty/files/${id}`, data).then((r) => r.data),
  removeFile: (id) => api.delete(`/faculty/files/${id}`).then((r) => r.data),
  getFileVersions: (id) => api.get(`/faculty/files/${id}/versions`).then((r) => r.data),
  replaceFileVersion: (id, formData, onProgress) =>
    api
      .post(`/faculty/files/${id}/versions`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: onProgress })
      .then((r) => r.data),
};

// ----- Search -----
export const searchApi = {
  search: (params) => api.get('/search', { params }).then((r) => r.data),
  suggestions: (q) => api.get('/search/suggestions', { params: { q } }).then((r) => r.data),
};

// ----- Super Admin -----
export const superAdminApi = {
  listUsers: (params) => api.get('/super-admin/users', { params }).then((r) => r.data),
  getUser: (id) => api.get(`/super-admin/users/${id}`).then((r) => r.data),
  updateUserRole: (id, role) => api.patch(`/super-admin/users/${id}/role`, { role }).then((r) => r.data),
  updateUserStatus: (id, status) => api.patch(`/super-admin/users/${id}/status`, { status }).then((r) => r.data),
  listFiles: (params) => api.get('/super-admin/files', { params }).then((r) => r.data),
  getFile: (id) => api.get(`/super-admin/files/${id}`).then((r) => r.data),
  removeFile: (id) => api.delete(`/super-admin/files/${id}`).then((r) => r.data),
  getSettings: () => api.get('/super-admin/settings').then((r) => r.data),
  updateSettings: (data) => api.patch('/super-admin/settings', data).then((r) => r.data),

  // ----- Faculty management -----
  listFaculty: () => api.get('/super-admin/faculty').then((r) => r.data),
  createFaculty: (data) => api.post('/super-admin/faculty', data).then((r) => r.data),
  updateFaculty: (id, data) => api.patch(`/super-admin/faculty/${id}`, data).then((r) => r.data),
};

// ----- Analytics (super admin dashboard) -----
export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard').then((r) => r.data),
};
