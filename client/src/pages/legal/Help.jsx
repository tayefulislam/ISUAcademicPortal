import { LifeBuoy, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import Seo from '../../components/Seo.jsx';
import LegalShell, { LegalSection, LegalBullets, LegalCallout } from '../../components/legal/LegalShell.jsx';
import ConfigValue from '../../components/legal/ConfigValue.jsx';
import { siteConfig, isPlaceholder } from '../../config/site.js';

const SECTIONS = [
  { id: 'login', label: 'I cannot log in' },
  { id: 'forgot-password', label: 'I forgot my password' },
  { id: 'verification', label: 'My ID verification is pending' },
  { id: 'course', label: 'I cannot see my course' },
  { id: 'upload', label: 'I cannot upload a file' },
  { id: 'notifications', label: 'I am not receiving notifications' },
  { id: 'incorrect-info', label: 'I found incorrect information' },
  { id: 'contact', label: 'Contact support' },
];

function Q({ id, question, children }) {
  return (
    <LegalSection id={id} title={question}>
      {children}
    </LegalSection>
  );
}

export default function Help() {
  const contactEmail = siteConfig.supportEmail;
  const hasHours = !!siteConfig.supportHours;
  const hasResponseTime = !!siteConfig.responseTime;

  return (
    <>
      <Seo
        title="Help & Support | ISU Academic Portal"
        description="Help and support for the ISU Academic Portal — sign-in problems, password resets, Student ID verification, course visibility and upload issues."
        path="/help"
        robots="index, follow"
      />

      <LegalShell
        title="Help & Support"
        icon={LifeBuoy}
        intro="Answers to the most common questions about signing in, verifying your account, seeing your courses and uploading files. If you still need help, contact information is at the bottom of this page."
        sections={SECTIONS}
      >
        <Q id="login" question="I cannot log in">
          <p>If your sign-in is not working, work through these steps in order:</p>
          <LegalBullets
            items={[
              'Check that your email address, Student ID or phone number is typed correctly, and that your password is correct.',
              'If your email has not been verified yet, you will be asked for a verification code. Check your inbox for the code and enter it, or use “Resend code” on the verification screen.',
              'If your account is awaiting Student ID approval, you can still sign in, but some materials stay restricted until it is approved.',
              'If you were told your account has been blocked, contact support — blocked accounts cannot be restored without an administrator.',
            ]}
          />
          <p>
            The type of identifier you use depends on the university&apos;s settings: email always works, while Student ID
            and phone sign-in can be enabled or disabled by the university.
          </p>
          <p>If none of the above helps, contact support using the details below.</p>
        </Q>

        <Q id="forgot-password" question="I forgot my password">
          <p>You can reset your password yourself, as long as password reset is enabled by the university:</p>
          <ol className="list-decimal pl-5 space-y-1.5 marker:text-brand-500">
            <li>
              Go to the <Link to="/login" className="text-brand-700 font-medium hover:underline">sign-in page</Link> and
              choose <strong>“Forgot password?”</strong>.
            </li>
            <li>Enter the email address registered to your account.</li>
            <li>
              If an account exists for that email, a password-reset link is sent to it. For your security, the page shows
              the same message whether or not the email is registered.
            </li>
            <li>
              Open the link in the email and set a new password. For your security the link is time-limited (it expires
              after a short period) and can only be used once.
            </li>
            <li>After changing your password, any session signed in with the old password is signed out.</li>
          </ol>
          <LegalCallout tone="info" title="Didn't get the email?">
            <p>
              Check your spam or junk folder, and make sure you entered the email address registered to your account. If
              the reset link has expired you can request a new one.
            </p>
          </LegalCallout>
          <p>
            If password reset by email is turned off by the university, or you no longer have access to your registered
            email, contact support to reset your password.
          </p>
        </Q>

        <Q id="verification" question="My Student ID / profile verification is pending">
          <p>The portal may ask students to verify their identity before granting access to restricted materials:</p>
          <LegalBullets
            items={[
              'Students registering with an official university email address are approved automatically once their email is verified — they are not asked for a Student ID photo.',
              'Other students are asked to upload a clear photo of their Student ID card from the “pending approval” screen.',
              'The uploaded image is reviewed by authorized university reviewers (faculty or administration).',
              'While your submission is waiting for review, your status is “pending”. You can still sign in, but restricted materials may not be available to you yet.',
              'If your submission is rejected, you will see the reason given by the reviewer, and you can submit a new, corrected image.',
            ]}
          />
          <p>
            Verification is handled by the university — there is no fixed processing time we can promise. If your
            submission has been pending for a long time, contact support with your Student ID.
          </p>
        </Q>

        <Q id="course" question="I cannot see my course">
          <p>
            What you can see depends on your account and enrollment. A course may not appear because:
          </p>
          <LegalBullets
            items={[
              'It belongs to a different department than the one on your account.',
              'It is intended for a different batch or semester than yours.',
              'Your enrollment for that course has not been approved or activated yet.',
              'Materials have not yet been published for your course.',
              'Your account is still awaiting verification or approval.',
            ]}
          />
          <p>
            If you have requested an additional, retake, backlog or improvement course, it becomes visible after that
            request is approved. If you believe your department, batch or semester is wrong, update it from your profile
            where possible, or contact support.
          </p>
        </Q>

        <Q id="upload" question="I cannot upload a file">
          <p>Check the following:</p>
          <LegalBullets
            items={[
              'File type: uploads are restricted to PDF; Word (DOC, DOCX); PowerPoint (PPT, PPTX); Excel (XLS, XLSX); plain text (TXT); ZIP archives; and common image formats (JPEG, PNG, WebP, GIF). Other file types are rejected.',
              'File size: each file must be within the maximum size configured by the university (commonly up to 10 MB per file).',
              'Number of files: up to 10 files can be uploaded in a single submission.',
              'Network: a slow or interrupted connection can cause an upload to fail — try again, preferably on a stable connection.',
              'Permission: uploading materials may be limited to faculty and administrators. Student material submission is available only when the university has enabled it, and submissions may need review before they are published.',
            ]}
          />
          <p>
            If your file meets these requirements but still fails to upload, note the file type and approximate size,
            and contact support.
          </p>
        </Q>

        <Q id="notifications" question="I am not receiving notifications">
          <LegalBullets
            items={[
              'Notifications are shown inside the portal in the notification bell, regardless of any other setting.',
              'Browser/app push notifications must be allowed for the portal in your browser or device settings, and can be turned on from your notification settings.',
              'On some devices, push notifications only work after the portal is added to the home screen.',
              'You can switch individual notification types on or off from your notification settings.',
            ]}
          />
        </Q>

        <Q id="incorrect-info" question="I found incorrect academic information">
          <p>
            If a grade, notice, enrollment or any other academic record looks wrong:
          </p>
          <LegalBullets
            items={[
              'Contact the faculty member responsible for that course, if you know who they are.',
              'Otherwise contact your department or an administrator, who can correct official records.',
              'You can update your own name, contact details and other profile information from the Profile page.',
              'For anything you cannot resolve, contact support and include the course, date and a short description of the problem.',
            ]}
          />
          <p>
            Academic records are the university&apos;s official data. The portal displays what the university maintains, so
            corrections are made by authorized staff.
          </p>
        </Q>

        <LegalSection id="contact" title="Contact support">
          <p>If the answers above did not resolve your issue, get in touch:</p>
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-start gap-3">
              <Mail size={18} className="mt-0.5 text-brand-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-500">Email</p>
                <ConfigValue field={contactEmail} kind="mail" />
              </div>
            </div>

            {hasHours && (
              <div>
                <p className="text-sm font-medium text-slate-500">Support hours</p>
                <p className="text-slate-800">{siteConfig.supportHours}</p>
              </div>
            )}

            {hasResponseTime && (
              <div>
                <p className="text-sm font-medium text-slate-500">Response time</p>
                <p className="text-slate-800">{siteConfig.responseTime}</p>
              </div>
            )}

            {!hasHours && !hasResponseTime && (
              <p className="text-sm text-slate-500">
                Support hours and response times have not been published. Requests are handled by the university during
                normal working hours.
              </p>
            )}
          </div>

          <p className="pt-2">
            When you contact support, include your name, Student ID (if you have one), the email on your account, and a
            clear description of the problem — including what you expected to happen and what happened instead.
          </p>

          {isPlaceholder(contactEmail) && (
            <LegalCallout tone="warning" title="Support email not yet configured">
              <p>
                The university has not yet supplied a public support email address. This placeholder must be replaced
                before the portal is released to the public or published on Google Play.
              </p>
            </LegalCallout>
          )}

          <p className="pt-2">
            Please also see our{' '}
            <Link to="/privacy-policy" className="text-brand-700 font-medium hover:underline">Privacy Policy</Link> and{' '}
            <Link to="/terms" className="text-brand-700 font-medium hover:underline">Terms of Service</Link>.
          </p>
        </LegalSection>
      </LegalShell>
    </>
  );
}
