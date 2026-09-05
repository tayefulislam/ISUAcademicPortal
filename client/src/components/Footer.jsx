export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-sm text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>&copy; {new Date().getFullYear()} ISU Academic Portal. All rights reserved.</p>
        <p>Built for centralized academic resource discovery.</p>
      </div>
    </footer>
  );
}
