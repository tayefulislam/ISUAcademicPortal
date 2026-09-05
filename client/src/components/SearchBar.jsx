import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function SearchBar({ initialValue = '', size = 'lg', onSubmit }) {
  const [value, setValue] = useState(initialValue);
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit(value);
    } else {
      navigate(`/search?q=${encodeURIComponent(value)}`);
    }
  };

  const sizes = {
    lg: 'h-14 text-base pl-14',
    md: 'h-11 text-sm pl-11',
  };

  return (
    <form onSubmit={submit} className="relative w-full">
      <Search
        className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${size === 'lg' ? 'left-5' : 'left-3.5'}`}
        size={size === 'lg' ? 22 : 18}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search course, course ID, file name, batch..."
        className={`w-full ${sizes[size]} pr-28 rounded-xl border border-slate-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent`}
      />
      <button
        type="submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
      >
        Search
      </button>
    </form>
  );
}
