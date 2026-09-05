export default function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
      {Icon && (
        <span className="p-3 rounded-lg bg-brand-50 text-brand-600">
          <Icon size={22} />
        </span>
      )}
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}
