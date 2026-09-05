import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext.jsx';
import { initAnalytics, trackPageView } from './utils/analytics.js';
import MainLayout from './layouts/MainLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import Home from './pages/Home.jsx';
import SearchResults from './pages/SearchResults.jsx';
import FileDetails from './pages/FileDetails.jsx';
import Courses from './pages/Courses.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import NotFound from './pages/NotFound.jsx';

import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminFiles from './pages/admin/AdminFiles.jsx';
import AdminUpload from './pages/admin/AdminUpload.jsx';
import AdminDepartments from './pages/admin/AdminDepartments.jsx';
import AdminCourses from './pages/admin/AdminCourses.jsx';
import AdminBatches from './pages/admin/AdminBatches.jsx';
import AdminCategories from './pages/admin/AdminCategories.jsx';

function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

export default function App() {
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <ToastProvider>
      <AnalyticsTracker />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/files/:id" element={<FileDetails />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route
          path="/admin"
          element={
            <ProtectedRoute adminOnly>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="upload" element={<AdminUpload />} />
          <Route path="departments" element={<AdminDepartments />} />
          <Route path="courses" element={<AdminCourses />} />
          <Route path="batches" element={<AdminBatches />} />
          <Route path="categories" element={<AdminCategories />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
