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
import RoutineFloatingWidget from './components/routine/RoutineFloatingWidget.jsx';
import { useAuth } from './context/AuthContext.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import NotificationSettings from './pages/NotificationSettings.jsx';
import SuperAdminNotifications from './pages/superadmin/SuperAdminNotifications.jsx';
import Manual from './pages/Manual.jsx';
import Routine from './pages/Routine.jsx';

import Home from './pages/Home.jsx';
import SearchResults from './pages/SearchResults.jsx';
import FileDetails from './pages/FileDetails.jsx';
import Courses from './pages/Courses.jsx';
import CoursePage from './pages/CoursePage.jsx';
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
import Documents from './pages/Documents.jsx';
import DocumentGenerate from './pages/DocumentGenerate.jsx';
import DocumentDetail from './pages/DocumentDetail.jsx';
import WriteApplication from './pages/WriteApplication.jsx';
import MyApplications from './pages/MyApplications.jsx';
import ApplicationDetail from './pages/ApplicationDetail.jsx';
import ApplicationTypes from './pages/admin/ApplicationTypes.jsx';
import ApplicationRecipients from './pages/admin/ApplicationRecipients.jsx';
import AiCredits from './pages/superadmin/AiCredits.jsx';
import PrivacyPolicy from './pages/legal/PrivacyPolicy.jsx';
import Terms from './pages/legal/Terms.jsx';
import Help from './pages/legal/Help.jsx';
import Contact from './pages/legal/Contact.jsx';
import Forbidden403 from './pages/Forbidden403.jsx';
import NotFound from './pages/NotFound.jsx';

import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminFiles from './pages/admin/AdminFiles.jsx';
import AdminUpload from './pages/admin/AdminUpload.jsx';
import AdminStudentApprovals from './pages/admin/AdminStudentApprovals.jsx';
import DocumentTemplates from './pages/admin/DocumentTemplates.jsx';
import DocumentTemplateForm from './pages/admin/DocumentTemplateForm.jsx';
import DocumentTemplateEditor from './pages/admin/DocumentTemplateEditor.jsx';
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
import RoutineManager from './pages/shared/RoutineManager.jsx';
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
      {user && <RoutineFloatingWidget />}
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/files/:id" element={<FileDetails />} />
          <Route path="/courses" element={<Courses />} />
          {/* The signed-in academic calendar. Every view behind it is scoped
              server-side from the user's own record. */}
          <Route
            path="/routine"
            element={
              <ProtectedRoute>
                <Routine />
              </ProtectedRoute>
            }
          />
          {/* My Courses → course → batch → content. Auth-only: every list behind
              it is fetched through the audience endpoints, so the server decides
              what this viewer may see. */}
          <Route
            path="/courses/:courseId"
            element={
              <ProtectedRoute>
                <CoursePage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-otp" element={<VerifyOtp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* Profile stays reachable mid-verification/approval on purpose: it is
              where Log out lives, and it is the one screen the "not approved yet"
              state is allowed to show. */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute skipGate>
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
          {/* The gate's own destination — not re-gated, or it would redirect to
              itself in a loop. */}
          <Route
            path="/pending-approval"
            element={
              <ProtectedRoute skipGate>
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
          {/* Document Generator — cover pages and other generated PDFs. The
              templates a student may use are filtered server-side, and the
              official values are filled from their own record server-side. */}
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <Documents />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents/new"
            element={
              <ProtectedRoute>
                <DocumentGenerate />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents/:id"
            element={
              <ProtectedRoute>
                <DocumentDetail />
              </ProtectedRoute>
            }
          />
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
          {/* Public Legal & Support pages — deliberately unauthenticated so they
              open directly by URL in a browser and in the Android WebView. */}
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/help" element={<Help />} />
          <Route path="/contact" element={<Contact />} />
          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <Messages />
              </ProtectedRoute>
            }
          />
          {/* Write Application — draft a formal letter with AI, edit it, export. */}
          <Route
            path="/write-application"
            element={
              <ProtectedRoute>
                <WriteApplication />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-applications"
            element={
              <ProtectedRoute>
                <MyApplications />
              </ProtectedRoute>
            }
          />
          <Route
            path="/applications/:id"
            element={
              <ProtectedRoute>
                <ApplicationDetail />
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
          <Route path="routine" element={<RoutineManager />} />
          <Route path="document-templates" element={<DocumentTemplates />} />
          <Route path="document-templates/new" element={<DocumentTemplateForm />} />
          <Route path="document-templates/:id/edit" element={<DocumentTemplateForm />} />
          <Route path="document-templates/:id" element={<DocumentTemplateEditor />} />
          <Route path="application-types" element={<ApplicationTypes />} />
          <Route path="application-recipients" element={<ApplicationRecipients />} />
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
          <Route path="routine" element={<RoutineManager />} />
          {/* Registered here as well as under /admin: Super Admin and
              Administrator have the same access, and the pages keep their links
              inside whichever panel opened them (see hooks/usePanelBase.js). */}
          <Route path="document-templates" element={<DocumentTemplates />} />
          <Route path="document-templates/new" element={<DocumentTemplateForm />} />
          <Route path="document-templates/:id/edit" element={<DocumentTemplateForm />} />
          <Route path="document-templates/:id" element={<DocumentTemplateEditor />} />
          <Route path="application-types" element={<ApplicationTypes />} />
          <Route path="application-recipients" element={<ApplicationRecipients />} />
          <Route path="ai-credits" element={<AiCredits />} />
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
          <Route path="routine" element={<RoutineManager />} />
          <Route path="manual" element={<Manual role="faculty" />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
