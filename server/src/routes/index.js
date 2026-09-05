import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import departmentRoutes from './departmentRoutes.js';
import courseRoutes from './courseRoutes.js';
import batchRoutes from './batchRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import fileRoutes from './fileRoutes.js';
import searchRoutes from './searchRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';

const router = Router();

router.get('/health', (req, res) => res.json({ success: true, message: 'ok' }));

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/departments', departmentRoutes);
router.use('/courses', courseRoutes);
router.use('/batches', batchRoutes);
router.use('/categories', categoryRoutes);
router.use('/files', fileRoutes);
router.use('/search', searchRoutes);
router.use('/analytics', analyticsRoutes);

export default router;
