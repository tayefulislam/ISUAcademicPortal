import { useState } from 'react';
import AdminDepartments from '../admin/AdminDepartments.jsx';
import AdminCourses from '../admin/AdminCourses.jsx';
import AdminBatches from '../admin/AdminBatches.jsx';
import AdminSemesters from '../admin/AdminSemesters.jsx';
import AdminCategories from '../admin/AdminCategories.jsx';

const TABS = [
  { key: 'departments', label: 'Departments', Component: AdminDepartments },
  { key: 'courses', label: 'Courses', Component: AdminCourses },
  { key: 'batches', label: 'Batches', Component: AdminBatches },
  { key: 'semesters', label: 'Semesters', Component: AdminSemesters },
  { key: 'categories', label: 'Categories', Component: AdminCategories },
];

export default function SuperAdminSystem() {
  const [tab, setTab] = useState('departments');
  const Active = TABS.find((t) => t.key === tab)?.Component;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">System Management</h1>
      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              tab === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  );
}
