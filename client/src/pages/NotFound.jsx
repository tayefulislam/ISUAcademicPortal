import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24">
      <p className="text-6xl font-bold text-brand-600">404</p>
      <p className="text-slate-500 mt-2 mb-6">Page not found.</p>
      <Link to="/" className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700">
        Go home
      </Link>
    </div>
  );
}
