import { Router } from 'express';
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

const router = Router();

router.get('/health', (req, res) => res.json({ success: true, message: 'ok' }));

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
router.use('/admin', adminRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/search', searchRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/reviews', reviewRoutes);
router.use('/faculty', facultyRoutes);

export default router;
