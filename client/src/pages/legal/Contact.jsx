import { Link } from 'react-router-dom';
import { Mail, ShieldCheck, Scale, MapPin, Phone, Clock, MessageSquareWarning } from 'lucide-react';
import Seo from '../../components/Seo.jsx';
import LegalShell, { LegalSection, LegalBullets, LegalCallout } from '../../components/legal/LegalShell.jsx';
import ConfigValue from '../../components/legal/ConfigValue.jsx';
import { siteConfig, isPlaceholder } from '../../config/site.js';

const SECTIONS = [
  { id: 'support', label: 'General support' },
  { id: 'privacy', label: 'Privacy requests' },
  { id: 'legal', label: 'Legal & terms' },
  { id: 'visit', label: 'University location' },
  { id: 'what-to-include', label: 'What to include' },
];

function Channel({ icon: Icon, title, description, field, configuredNote }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-600 mt-0.5 mb-2">{description}</p>
          <ConfigValue field={field} kind="mail" />
          {configuredNote && isPlaceholder(field) && (
            <p className="text-xs text-amber-700 mt-2">{configuredNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Contact() {
  const anyPlaceholder =
    isPlaceholder(siteConfig.supportEmail) ||
    isPlaceholder(siteConfig.privacyEmail) ||
    isPlaceholder(siteConfig.contactPhone) ||
    isPlaceholder(siteConfig.contactAddress);

  return (
    <>
      <Seo
        title="Contact | ISU Academic Portal"
        description="Contact the ISU Academic Portal support team for help with your account, verification, courses or technical issues."
        path="/contact"
        robots="index, follow"
      />

      <LegalShell
        title="Contact"
        icon={Mail}
        intro="Use the appropriate contact below so your message reaches the right team. Please choose the correct channel for your enquiry — it helps us respond faster."
        sections={SECTIONS}
      >
        <LegalSection id="support" title="General support">
          <Channel
            icon={Mail}
            title="Portal support"
            description="Account access, sign-in problems, verification, courses, uploads and general technical issues."
            field={siteConfig.supportEmail}
          />
          {siteConfig.supportHours && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock size={15} className="text-slate-400" />
              <span>{siteConfig.supportHours}</span>
            </div>
          )}
          <p>
            If it is a bug or a suggestion about the portal itself, you can also use the{' '}
            <Link to="/feedback" className="text-brand-700 font-medium hover:underline">Feedback form</Link>.
          </p>
        </LegalSection>

        <LegalSection id="privacy" title="Privacy requests">
          <Channel
            icon={ShieldCheck}
            title="Privacy contact"
            description="Requests to access, correct or delete your personal information, and any privacy questions."
            field={siteConfig.privacyEmail}
          />
          <p>
            For more detail on what you can request, see section 8 of our{' '}
            <Link to="/privacy-policy" className="text-brand-700 font-medium hover:underline">Privacy Policy</Link>.
          </p>
        </LegalSection>

        <LegalSection id="legal" title="Legal & terms">
          <Channel
            icon={Scale}
            title="Terms contact"
            description="Questions about the Terms of Service or acceptable use of the portal."
            field={siteConfig.legalEmail}
          />
          <p>
            Read the full{' '}
            <Link to="/terms" className="text-brand-700 font-medium hover:underline">Terms of Service</Link>.
          </p>
        </LegalSection>

        <LegalSection id="visit" title="University location">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-start gap-3">
              <MapPin size={18} className="mt-0.5 text-brand-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-500">Address</p>
                <ConfigValue field={siteConfig.contactAddress} kind="address" />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Phone size={18} className="mt-0.5 text-brand-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-500">Phone</p>
                <ConfigValue field={siteConfig.contactPhone} kind="phone" />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MessageSquareWarning size={18} className="mt-0.5 text-slate-400 shrink-0" />
              <p className="text-sm text-slate-500">
                Postal address and phone number are optional. If they are not configured, please use email to contact the
                university.
              </p>
            </div>
          </div>
        </LegalSection>

        <LegalSection id="what-to-include" title="What to include">
          <p>To help us resolve your issue quickly, include:</p>
          <LegalBullets
            items={[
              'Your full name and the email address registered to your account.',
              'Your Student ID or Roll number, if you have one.',
              'A clear description of the problem — what you expected and what actually happened.',
              'The device and browser you were using, and the page you were on.',
              'Screenshots, if they help explain the issue (avoid sharing your password).',
            ]}
          />
          <p>
            Never send your password, one-time verification codes, or reset links to anyone — including support staff.
            The university will never ask you for these.
          </p>
        </LegalSection>

        {anyPlaceholder && (
          <LegalCallout tone="warning" title="Contact details are placeholders">
            <p>
              One or more contact details on this page have not yet been configured by the university. They are shown as
              marked placeholders and must be replaced before the portal is released to the public or published on
              Google Play.
            </p>
          </LegalCallout>
        )}
      </LegalShell>
    </>
  );
}
