import { connectDB } from '../config/db.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Category from '../models/Category.js';
import User from '../models/User.js';
import mongoose from 'mongoose';

const CATEGORIES = [
  'Lecture Notes',
  'Assignment',
  'Question Paper',
  'Lab',
  'Exam',
  'Midterm',
  'Final',
  'Tutorial',
  'Project',
  'Syllabus',
  'Book',
  'Other',
];

const DEPARTMENTS = [
  { name: 'Computer Science & Engineering', code: 'CSE' },
  { name: 'Electrical & Electronic Engineering', code: 'EEE' },
  { name: 'Business Administration', code: 'BBA' },
  { name: 'English', code: 'ENG' },
  { name: 'Civil Engineering', code: 'CE' },
];

async function seed() {
  await connectDB();

  const departments = {};
  for (const d of DEPARTMENTS) {
    const dept = await Department.findOneAndUpdate({ code: d.code }, d, { upsert: true, new: true });
    departments[d.code] = dept;
  }

  const courses = [
    { name: 'Discrete Mathematics', courseId: 'CSE-203', department: 'CSE', credit: 3, semester: '3rd Semester' },
    { name: 'Physics I', courseId: 'PHY-101', department: 'CSE', credit: 3, semester: '1st Semester' },
    { name: 'English I', courseId: 'ENG-101', department: 'CSE', credit: 2, semester: '1st Semester' },
  ];
  for (const c of courses) {
    await Course.findOneAndUpdate(
      { courseId: c.courseId },
      { ...c, department: departments[c.department]._id },
      { upsert: true, new: true }
    );
  }

  for (let i = 1; i <= 14; i += 1) {
    const code = `BATCH-${String(i).padStart(2, '0')}`;
    await Batch.findOneAndUpdate({ code }, { name: code, code }, { upsert: true, new: true });
  }

  for (const name of CATEGORIES) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await Category.findOneAndUpdate({ slug }, { name, slug }, { upsert: true, new: true });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@university.edu';
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: 'System Admin',
      email: adminEmail,
      password: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
      role: 'admin',
    });
    console.log(`[seed] admin created: ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD || 'Admin@12345'}`);
  } else {
    console.log('[seed] admin already exists, skipped');
  }

  console.log('[seed] done');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
