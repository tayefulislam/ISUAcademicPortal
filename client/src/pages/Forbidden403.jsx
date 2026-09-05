import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function Forbidden403() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-4">
      <ShieldAlert className="text-red-400 mb-4" size={56} />
      <p className="text-6xl font-bold text-red-500">403</p>
      <p className="text-slate-500 mt-2 mb-6">You don&apos;t have permission to view this page.</p>
      <Link to="/" className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700">
        Go home
      </Link>
    </div>
  );
}
