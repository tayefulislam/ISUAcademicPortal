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
import EnableNotificationPrompt from './components/notifications/EnableNotificationPrompt.jsx';
import { useAuth } from './context/AuthContext.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import NotificationSettings from './pages/NotificationSettings.jsx';
import SuperAdminNotifications from './pages/superadmin/SuperAdminNotifications.jsx';
import Manual from './pages/Manual.jsx';

import Home from './pages/Home.jsx';
import SearchResults from './pages/SearchResults.jsx';
import FileDetails from './pages/FileDetails.jsx';
import Courses from './pages/Courses.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import VerifyOtp from './pages/VerifyOtp.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Profile from './pages/Profile.jsx';
import Bookmarks from './pages/Bookmarks.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PendingApproval from './pages/PendingApproval.jsx';
import MyCourses from './pages/MyCourses.jsx';
import StudentSubmitMaterial from './pages/StudentSubmitMaterial.jsx';
import Notices from './pages/Notices.jsx';
import Assignments from './pages/Assignments.jsx';
import Quizzes from './pages/Quizzes.jsx';
import QuizAttempt from './pages/QuizAttempt.jsx';
import QuizResult from './pages/QuizResult.jsx';
import StudentResultRedirect from './pages/StudentResultRedirect.jsx';
import PublicExamLanding from './pages/public/PublicExamLanding.jsx';
import PublicExamAttempt from './pages/public/PublicExamAttempt.jsx';
import PublicExamResult from './pages/public/PublicExamResult.jsx';
import FeedbackForm from './pages/FeedbackForm.jsx';
import Forbidden403 from './pages/Forbidden403.jsx';
import NotFound from './pages/NotFound.jsx';

import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminFiles from './pages/admin/AdminFiles.jsx';
import AdminUpload from './pages/admin/AdminUpload.jsx';
import AdminStudentApprovals from './pages/admin/AdminStudentApprovals.jsx';
import { facultyApi } from './api/endpoints.js';

import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard.jsx';
import SuperAdminUsers from './pages/superadmin/SuperAdminUsers.jsx';
import SuperAdminFaculty from './pages/superadmin/SuperAdminFaculty.jsx';
import SuperAdminFiles from './pages/superadmin/SuperAdminFiles.jsx';
import SuperAdminSystem from './pages/superadmin/SuperAdminSystem.jsx';
import SuperAdminFeedback from './pages/superadmin/SuperAdminFeedback.jsx';
import SuperAdminErrorLogs from './pages/superadmin/SuperAdminErrorLogs.jsx';

import FacultyDashboard from './pages/faculty/FacultyDashboard.jsx';
import FacultyFiles from './pages/faculty/FacultyFiles.jsx';
import FacultyCourses from './pages/faculty/FacultyCourses.jsx';
import FacultyChapterTopics from './pages/faculty/FacultyChapterTopics.jsx';
import FacultyUpload from './pages/faculty/FacultyUpload.jsx';

import ReviewQueue from './pages/shared/ReviewQueue.jsx';
import NoticeManager from './pages/shared/NoticeManager.jsx';
import AssignmentManager from './pages/shared/AssignmentManager.jsx';
import QuestionBank from './pages/shared/QuestionBank.jsx';
import QuizManager from './pages/shared/QuizManager.jsx';
import Messages from './pages/shared/Messages.jsx';
import EmailComposer from './pages/shared/EmailComposer.jsx';
import EnrollmentManager from './pages/shared/EnrollmentManager.jsx';
import FacultyEnrollmentDashboard from './pages/faculty/FacultyEnrollmentDashboard.jsx';

function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

export default function App() {
  const { user } = useAuth();
  useEffect(() => {
    initAnalytics();
  }, []);

  // Listens for the service worker's notificationclick postMessage (spec
  // §10/§24: clicking a push notification must open the PWA and navigate to
  // the right resource, focusing an existing window when possible).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event) => {
      if (event.data?.type === 'notification-click' && event.data.url) {
        window.location.assign(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return (
    <ToastProvider>
      <AnalyticsTracker />
      <PwaUpdatePrompt />
      {user && <EnableNotificationPrompt />}
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/files/:id" element={<FileDetails />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-otp" element={<VerifyOtp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications/settings"
            element={
              <ProtectedRoute>
                <NotificationSettings />
              </ProtectedRoute>
            }
          />
          <Route path="/manual" element={<Manual role="student" />} />
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
            path="/pending-approval"
            element={
              <ProtectedRoute>
                <PendingApproval />
              </ProtectedRoute>
            }
          />
          <Route
            path="/submit-material"
            element={
              <ProtectedRoute roles={['student']} orScopedAdminTier>
                <StudentSubmitMaterial />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-courses"
            element={
              <ProtectedRoute roles={['student']} orAdminTier>
                <MyCourses />
              </ProtectedRoute>
            }
          />
          <Route path="/notices" element={<Notices />} />
          <Route
            path="/assignments"
            element={
              <ProtectedRoute>
                <Assignments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quizzes"
            element={
              <ProtectedRoute>
                <Quizzes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quizzes/:id/attempt/:attemptId"
            element={
              <ProtectedRoute>
                <QuizAttempt />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quizzes/:id/result/:attemptId"
            element={
              <ProtectedRoute>
                <QuizResult />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/results/:attemptId"
            element={
              <ProtectedRoute>
                <StudentResultRedirect />
              </ProtectedRoute>
            }
          />
          <Route path="/exam/:slug" element={<PublicExamLanding />} />
          <Route path="/exam/:slug/attempt/:attemptId" element={<PublicExamAttempt />} />
          <Route path="/exam/:slug/result/:attemptId" element={<PublicExamResult />} />
          <Route path="/feedback" element={<FeedbackForm />} />
          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <Messages />
              </ProtectedRoute>
            }
          />
          <Route path="/403" element={<Forbidden403 />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route
          path="/admin"
          element={
            <ProtectedRoute adminTier>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="upload" element={<AdminUpload />} />
          <Route path="approvals" element={<AdminStudentApprovals />} />
          <Route path="reviews" element={<ReviewQueue />} />
          <Route path="notices" element={<NoticeManager />} />
          <Route path="assignments" element={<AssignmentManager />} />
          <Route path="question-bank" element={<QuestionBank />} />
          <Route path="quizzes" element={<QuizManager />} />
          <Route path="messages" element={<Messages />} />
          <Route path="emails" element={<EmailComposer />} />
          <Route path="enrollments" element={<EnrollmentManager />} />
          <Route path="manual" element={<Manual role="admin" />} />
        </Route>

        <Route
          path="/super-admin"
          element={
            <ProtectedRoute roles={['super_admin', 'administrator']}>
              <SuperAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SuperAdminDashboard />} />
          <Route path="users" element={<SuperAdminUsers />} />
          <Route path="approvals" element={<AdminStudentApprovals />} />
          <Route path="faculty" element={<SuperAdminFaculty />} />
          <Route path="files" element={<SuperAdminFiles />} />
          <Route path="system" element={<SuperAdminSystem />} />
          <Route path="feedback" element={<SuperAdminFeedback />} />
          <Route path="error-logs" element={<SuperAdminErrorLogs />} />
          <Route path="messages" element={<Messages />} />
          <Route path="emails" element={<EmailComposer />} />
          <Route path="enrollments" element={<EnrollmentManager />} />
          <Route path="notifications" element={<SuperAdminNotifications />} />
          <Route path="manual" element={<Manual role="super_admin" />} />
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
          <Route path="courses" element={<FacultyCourses />} />
          <Route path="chapters-topics" element={<FacultyChapterTopics />} />
          <Route path="upload" element={<FacultyUpload />} />
          <Route path="reviews" element={<ReviewQueue />} />
          <Route path="student-id-approvals" element={<AdminStudentApprovals api={facultyApi} />} />
          <Route path="files" element={<FacultyFiles />} />
          <Route path="notices" element={<NoticeManager />} />
          <Route path="assignments" element={<AssignmentManager />} />
          <Route path="question-bank" element={<QuestionBank />} />
          <Route path="quizzes" element={<QuizManager />} />
          <Route path="messages" element={<Messages />} />
          <Route path="emails" element={<EmailComposer />} />
          <Route path="enrollments" element={<EnrollmentManager />} />
          <Route path="enrollments/roster" element={<FacultyEnrollmentDashboard />} />
          <Route path="manual" element={<Manual role="faculty" />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
