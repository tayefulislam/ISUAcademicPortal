import File from '../models/File.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /api/analytics/dashboard — aggregated numbers for the admin dashboard.
// This reflects data already tracked in MongoDB (views/downloads counters);
// raw traffic/device/source analytics live in Google Analytics 4 (client-side).
export const dashboard = asyncHandler(async (req, res) => {
  const [totals, mostViewed, mostDownloaded, recentUploads, popularCourses, popularDepartments] = await Promise.all([
    Promise.all([
      File.countDocuments(),
      Department.countDocuments(),
      Course.countDocuments(),
      Batch.countDocuments(),
      User.countDocuments(),
      File.aggregate([{ $group: { _id: null, downloads: { $sum: '$downloads' }, views: { $sum: '$views' } } }]),
    ]),
    File.find().select('title courseName views').sort({ views: -1 }).limit(5),
    File.find().select('title courseName downloads').sort({ downloads: -1 }).limit(5),
    File.find().select('title courseName createdAt').sort({ createdAt: -1 }).limit(5),
    File.aggregate([
      { $group: { _id: '$courseName', views: { $sum: '$views' }, files: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 5 },
    ]),
    File.aggregate([
      { $group: { _id: '$departmentCode', views: { $sum: '$views' }, files: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const [files, departments, courses, batches, users, sums] = totals;
  const { downloads = 0, views = 0 } = sums[0] || {};

  res.json({
    success: true,
    data: {
      totals: { files, departments, courses, batches, users, downloads, views },
      mostViewed,
      mostDownloaded,
      recentUploads,
      popularCourses,
      popularDepartments,
    },
  });
});
