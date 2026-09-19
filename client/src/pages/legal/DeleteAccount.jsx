import { Link } from 'react-router-dom';
import { Trash2, ShieldCheck } from 'lucide-react';
import Seo from '../../components/Seo.jsx';
import LegalShell, { LegalSection, LegalBullets, LegalCallout } from '../../components/legal/LegalShell.jsx';
import ConfigValue from '../../components/legal/ConfigValue.jsx';
import { siteConfig } from '../../config/site.js';

// The public account-deletion page.
//
// Google Play requires an app that lets people create accounts to provide a
// web resource where deletion can be requested, in addition to the in-app
// route — so this page exists at a fixed, public URL and says the same thing
// the in-app screen does.

const SECTIONS = [
  { id: 'in-app', label: 'From inside the app' },
  { id: 'no-access', label: "If you can't sign in" },
  { id: 'removed', label: 'What is removed' },
  { id: 'kept', label: 'What the university keeps' },
];

export default function DeleteAccount() {
  return (
    <>
      <Seo
        title="Delete your account | ISU Academic Portal"
        description="How to request deletion of your ISU Academic Portal account, what is removed and what the university must retain."
        path="/delete-account"
        robots="index, follow"
      />

      <LegalShell
        title="Delete your account"
        icon={Trash2}
        intro="You can ask for your ISU Academic Portal account to be deleted at any time. A university administrator reviews the request before it is carried out, because some academic records have to be kept."
        sections={SECTIONS}
      >
        <LegalSection id="in-app" title="From inside the app">
          <p>
            Sign in to the portal, open <strong>Profile</strong>, and choose <strong>Delete my account</strong>. You will
            be asked to confirm, and can add a reason if you wish. Your request is then queued for review — nothing is
            removed at that moment.
          </p>
          <p>
            <Link to="/profile" className="text-brand-700 font-medium hover:underline">Go to your profile</Link>
            {' '}to submit a request.
          </p>
        </LegalSection>

        <LegalSection id="no-access" title="If you can't sign in">
          <p>
            If you no longer have access to your account — for example you have forgotten your password and cannot reset
            it, or your account was issued by the university — contact the privacy contact below and ask for your
            account to be deleted. Include the email address registered to the account so it can be identified.
          </p>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <span className="text-sm font-medium text-slate-500">Privacy contact:&nbsp;</span>
            <ConfigValue field={siteConfig.privacyEmail} kind="mail" />
          </div>
        </LegalSection>

        <LegalSection id="removed" title="What is removed">
          <p>When a deletion request is approved, the following are erased from your account:</p>
          <LegalBullets
            items={[
              'Your name and email address.',
              'Your phone number and Student ID / Roll number.',
              'Your Student ID photo, if one was on file, including the stored image itself.',
              'Your job title or designation, for staff accounts.',
              'Every active session — you are signed out of all devices immediately, and the account can no longer be used to sign in.',
            ]}
          />
        </LegalSection>

        <LegalSection id="kept" title="What the university keeps">
          <p>
            A university must keep certain academic records. These are <strong>kept, but no longer linked to you
            personally</strong> — your identifying details are removed from the account they belong to:
          </p>
          <LegalBullets
            items={[
              'Your submissions, quiz and exam attempts, marks and results.',
              'Your course enrollments and academic history.',
              'Materials you uploaded, which may still be used by the courses they were shared with.',
            ]}
          />
          <p>
            This is the reason deletion is reviewed rather than immediate: the portal cannot both honour a request and
            silently discard grades and course records the university is required to retain.
          </p>
          <LegalCallout tone="info" title="Questions">
            <p>
              See section 8 of our{' '}
              <Link to="/privacy-policy" className="text-brand-700 font-medium hover:underline">Privacy Policy</Link>
              {' '}for the full list of rights you can exercise, or contact the privacy contact above.
            </p>
          </LegalCallout>
        </LegalSection>
      </LegalShell>
    </>
  );
}
