import { siteConfig } from '../config/site.js';

// Public-facing footer, shared by every page rendered through MainLayout.
const Footer = () => {
  return (
    <footer className="border-t border-slate-200 bg-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-slate-500">
          <p>
            &copy; {new Date().getFullYear()} {siteConfig.appName}. All rights reserved.
          </p>
          <p>Built for centralized academic resource discovery.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
