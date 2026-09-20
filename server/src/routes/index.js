import { Router } from 'express';
import { getAppInfo } from '../controllers/appInfoController.js';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import profileRoutes from './profileRoutes.js';
import bookmarkRoutes from './bookmarkRoutes.js';
import departmentRoutes from './departmentRoutes.js';
import courseRoutes from './courseRoutes.js';
import batchRoutes from './batchRoutes.js';
import semesterRoutes from './semesterRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import chapterRoutes from './chapterRoutes.js';
import topicRoutes from './topicRoutes.js';
import fileRoutes from './fileRoutes.js';
import adminRoutes from './adminRoutes.js';
import superAdminRoutes from './superAdminRoutes.js';
import searchRoutes from './searchRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import facultyRoutes from './facultyRoutes.js';
import feedbackRoutes from './feedbackRoutes.js';
import reportRoutes from './reportRoutes.js';
import noticeRoutes from './noticeRoutes.js';
import assignmentRoutes from './assignmentRoutes.js';
import questionRoutes from './questionRoutes.js';
import quizRoutes from './quizRoutes.js';
import messageRoutes from './messageRoutes.js';
import emailRoutes from './emailRoutes.js';
import roleRoutes from './roleRoutes.js';
import courseEnrollmentRoutes from './courseEnrollmentRoutes.js';
import publicExamRoutes from './publicExamRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import adminNotificationRoutes from './adminNotificationRoutes.js';
import studentIdRoutes from './studentIdRoutes.js';
import deviceRoutes from './deviceRoutes.js';
import routineRoutes from './routineRoutes.js';
import eventRoutes from './eventRoutes.js';
import examRoutes from './examRoutes.js';
import eventsRoutes from './eventsRoutes.js';
import reminderRoutes from './reminderRoutes.js';
import documentRoutes from './documentRoutes.js';
import documentTemplateRoutes from './documentTemplateRoutes.js';
import documentCategoryRoutes from './documentCategoryRoutes.js';
import adminDocumentRoutes from './adminDocumentRoutes.js';
import adminDocumentAssetRoutes from './adminDocumentAssetRoutes.js';
import {
  applicationTypeRoutes,
  applicationRecipientRoutes,
  applicationRoutes,
  applicationExportRoutes,
  aiCreditRoutes,
} from './applicationRoutes.js';
import {
  adminApplicationTypeRoutes,
  adminApplicationRecipientRoutes,
  adminApplicationDepartmentRoutes,
  adminAiCreditRoutes,
} from './adminApplicationRoutes.js';

const router = Router();

router.get('/health', (req, res) => res.json({ success: true, message: 'ok' }));

// App-facing metadata for the Android client: the contributor list and the
// current release. Public on purpose — the credits screen is reachable before
// signing in, and nothing here is private.
router.get('/app-info', getAppInfo);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/profile', profileRoutes);
router.use('/bookmarks', bookmarkRoutes);
router.use('/departments', departmentRoutes);
router.use('/courses', courseRoutes);
router.use('/batches', batchRoutes);
router.use('/semesters', semesterRoutes);
router.use('/categories', categoryRoutes);
router.use('/chapters', chapterRoutes);
router.use('/topics', topicRoutes);
router.use('/files', fileRoutes);
// Document Generator. The /admin/... router is mounted BEFORE the generic /admin
// router so its path is matched first and never swallowed by it.
router.use('/admin/document-templates', adminDocumentRoutes);
router.use('/admin/document-assets', adminDocumentAssetRoutes);
router.use('/document-categories', documentCategoryRoutes);
router.use('/document-templates', documentTemplateRoutes);
router.use('/documents', documentRoutes);

// Write Application. The /admin/... routers are mounted BEFORE the generic
// /admin router so their paths are matched first and never swallowed by it.
router.use('/admin/application-types', adminApplicationTypeRoutes);
router.use('/admin/application-recipients', adminApplicationRecipientRoutes);
router.use('/admin/application-departments', adminApplicationDepartmentRoutes);
router.use('/admin/ai-credits', adminAiCreditRoutes);
router.use('/application-types', applicationTypeRoutes);
router.use('/application-recipients', applicationRecipientRoutes);
router.use('/applications', applicationRoutes);
router.use('/application-exports', applicationExportRoutes);
router.use('/ai-credits', aiCreditRoutes);

router.use('/admin', adminRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/search', searchRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/reviews', reviewRoutes);
router.use('/faculty', facultyRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/reports', reportRoutes);
router.use('/notices', noticeRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/questions', questionRoutes);
router.use('/quizzes', quizRoutes);
router.use('/messages', messageRoutes);
router.use('/emails', emailRoutes);
router.use('/roles', roleRoutes);
router.use('/course-enrollments', courseEnrollmentRoutes);
router.use('/public-exams', publicExamRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin/notifications', adminNotificationRoutes);
router.use('/student-id', studentIdRoutes);
router.use('/devices', deviceRoutes);

// Class routine & academic calendar.
router.use('/routine', routineRoutes);
router.use('/calendar', eventRoutes);
router.use('/exams', examRoutes);
router.use('/events', eventsRoutes);
// Cron target for class/exam reminders — secret-authenticated, not user-authenticated.
router.use('/internal/reminders', reminderRoutes);

export default router;
