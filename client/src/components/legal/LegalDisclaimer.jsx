import { Link } from 'react-router-dom';

// Compact legal disclaimer shown beneath the sign-in and registration forms.
// Kept deliberately small and low-contrast so it does not push the form out of
// view, with the two links users are most likely to need (Privacy Policy and
// Terms of Service) available right where they are needed.
export default function LegalDisclaimer() {
  return (
    <p className="mt-4 text-xs leading-relaxed text-slate-500 text-center">
      This portal is intended for authorized students, faculty, and staff. By continuing, you agree to follow the
      applicable university policies and the portal&apos;s{' '}
      <Link to="/terms" className="font-medium text-brand-600 hover:underline">
        Terms of Service
      </Link>{' '}
      and acknowledge the{' '}
      <Link to="/privacy-policy" className="font-medium text-brand-600 hover:underline">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
