import api from './axios.js';

// ----- Auth -----
export const authApi = {
  register: (data) => api.post('/auth/register', data).then((r) => r.data),
  login: (data) => api.post('/auth/login', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  changePassword: (data) => api.post('/auth/change-password', data).then((r) => r.data),
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
};

// ----- Analytics (super admin dashboard) -----
export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard').then((r) => r.data),
};
