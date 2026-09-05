import api from './axios.js';

// ----- Auth -----
export const authApi = {
  register: (data) => api.post('/auth/register', data).then((r) => r.data),
  login: (data) => api.post('/auth/login', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
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

// ----- Categories -----
export const categoryApi = {
  list: () => api.get('/categories').then((r) => r.data),
  create: (data) => api.post('/categories', data).then((r) => r.data),
  update: (id, data) => api.put(`/categories/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/categories/${id}`).then((r) => r.data),
};

// ----- Files -----
export const fileApi = {
  list: (params) => api.get('/files', { params }).then((r) => r.data),
  get: (id) => api.get(`/files/${id}`).then((r) => r.data),
  related: (id) => api.get(`/files/${id}/related`).then((r) => r.data),
  recent: (limit = 8) => api.get('/files/recent', { params: { limit } }).then((r) => r.data),
  popular: (limit = 8) => api.get('/files/popular', { params: { limit } }).then((r) => r.data),
  stats: () => api.get('/files/stats').then((r) => r.data),
  recordDownload: (id) => api.post(`/files/${id}/download`).then((r) => r.data),
  upload: (formData, onProgress) =>
    api
      .post('/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: onProgress,
      })
      .then((r) => r.data),
  update: (id, data) => api.put(`/files/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/files/${id}`).then((r) => r.data),
  bulkRemove: (ids) => api.post('/files/bulk-delete', { ids }).then((r) => r.data),
};

// ----- Search -----
export const searchApi = {
  search: (params) => api.get('/search', { params }).then((r) => r.data),
  suggestions: (q) => api.get('/search/suggestions', { params: { q } }).then((r) => r.data),
};

// ----- Users -----
export const userApi = {
  list: (params) => api.get('/users', { params }).then((r) => r.data),
  updateRole: (id, role) => api.put(`/users/${id}/role`, { role }).then((r) => r.data),
  setActive: (id, isActive) => api.put(`/users/${id}/active`, { isActive }).then((r) => r.data),
  favorites: () => api.get('/users/me/favorites').then((r) => r.data),
  toggleFavorite: (fileId) => api.post(`/users/me/favorites/${fileId}`).then((r) => r.data),
};

// ----- Analytics (admin dashboard) -----
export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard').then((r) => r.data),
};
