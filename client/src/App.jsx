import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext.jsx';
import { initAnalytics, trackPageView } from './utils/analytics.js';
import MainLayout from './layouts/MainLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import SuperAdminLayout from './layouts/SuperAdminLayout.jsx';
import FacultyLayout from './layouts/FacultyLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PwaUpdatePrompt from './components/PwaUpdatePrompt.jsx';

import Home from './pages/Home.jsx';
import SearchResults from './pages/SearchResults.jsx';
import FileDetails from './pages/FileDetails.jsx';
import Courses from './pages/Courses.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Profile from './pages/Profile.jsx';
import Bookmarks from './pages/Bookmarks.jsx';
import Dashboard from './pages/Dashboard.jsx';
import StudentSubmitMaterial from './pages/StudentSubmitMaterial.jsx';
import Forbidden403 from './pages/Forbidden403.jsx';
import NotFound from './pages/NotFound.jsx';

import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminFiles from './pages/admin/AdminFiles.jsx';
import AdminUpload from './pages/admin/AdminUpload.jsx';
import AdminStudentApprovals from './pages/admin/AdminStudentApprovals.jsx';

import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard.jsx';
import SuperAdminUsers from './pages/superadmin/SuperAdminUsers.jsx';
import SuperAdminFaculty from './pages/superadmin/SuperAdminFaculty.jsx';
import SuperAdminFiles from './pages/superadmin/SuperAdminFiles.jsx';
import SuperAdminSystem from './pages/superadmin/SuperAdminSystem.jsx';

import FacultyDashboard from './pages/faculty/FacultyDashboard.jsx';
import FacultyFiles from './pages/faculty/FacultyFiles.jsx';

import ReviewQueue from './pages/shared/ReviewQueue.jsx';

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
      <PwaUpdatePrompt />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/files/:id" element={<FileDetails />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-bookmarks"
            element={
              <ProtectedRoute>
                <Bookmarks />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/submit-material"
            element={
              <ProtectedRoute roles={['student']}>
                <StudentSubmitMaterial />
              </ProtectedRoute>
            }
          />
          <Route path="/403" element={<Forbidden403 />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['admin', 'super_admin']}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="upload" element={<AdminUpload />} />
          <Route path="approvals" element={<AdminStudentApprovals />} />
          <Route path="reviews" element={<ReviewQueue />} />
        </Route>

        <Route
          path="/super-admin"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <SuperAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SuperAdminDashboard />} />
          <Route path="users" element={<SuperAdminUsers />} />
          <Route path="faculty" element={<SuperAdminFaculty />} />
          <Route path="files" element={<SuperAdminFiles />} />
          <Route path="system" element={<SuperAdminSystem />} />
        </Route>

        <Route
          path="/faculty"
          element={
            <ProtectedRoute roles={['faculty']}>
              <FacultyLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<FacultyDashboard />} />
          <Route path="reviews" element={<ReviewQueue />} />
          <Route path="files" element={<FacultyFiles />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
