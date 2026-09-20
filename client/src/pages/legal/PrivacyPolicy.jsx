import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import Seo from '../../components/Seo.jsx';
import LegalShell, { LegalSection, LegalBullets, LegalCallout, LegalTable } from '../../components/legal/LegalShell.jsx';
import ConfigValue from '../../components/legal/ConfigValue.jsx';
import { siteConfig, isPlaceholder } from '../../config/site.js';

const SECTIONS = [
  { id: 'overview', label: '1. Overview' },
  { id: 'collect', label: '2. Information We Collect' },
  { id: 'use', label: '3. How We Use Information' },
  { id: 'sharing', label: '4. When Information Is Shared' },
  { id: 'storage', label: '5. Storage & Security' },
  { id: 'retention', label: '6. Data Retention' },
  { id: 'cookies', label: '7. Cookies, Local Storage & Analytics' },
  { id: 'rights', label: '8. Your Rights & Requests' },
  { id: 'children', label: "9. Children's Privacy" },
  { id: 'third-party', label: '10. Third-Party Services' },
  { id: 'changes', label: '11. Changes to This Policy' },
  { id: 'contact', label: '12. Contact Us' },
  { id: 'acknowledgements', label: 'Acknowledgements' },
];

export default function PrivacyPolicy() {
  const contactEmail = siteConfig.privacyEmail.configured ? siteConfig.privacyEmail : siteConfig.supportEmail;

  return (
    <>
      <Seo
        title="Privacy Policy | ISU Academic Portal"
        description="How the ISU Academic Portal collects, uses, stores and protects student, faculty and staff information."
        path="/privacy-policy"
        robots="index, follow"
      />

      <LegalShell
        title="Privacy Policy"
        icon={ShieldCheck}
        intro="This Privacy Policy explains what information the ISU Academic Portal collects, why it is collected, how it is protected, and the choices available to you. It applies to the web portal and to the portal when accessed through the Android app."
        metaRows={[
          { label: 'Effective date', value: siteConfig.effectiveDate },
          { label: 'Last updated', value: siteConfig.lastUpdated },
          { label: 'Version', value: siteConfig.policyVersion },
        ]}
        sections={SECTIONS}
      >
        <LegalSection id="overview" title="1. Overview">
          <p>
            The ISU Academic Portal is an academic management system operated for {siteConfig.universityName.configured ? siteConfig.universityName.value : 'the university'}{' '}
            and its students, faculty and staff. It is intended for authorized members of the university community.
          </p>
          <p>
            By using the portal you acknowledge the practices described in this policy. Where the university&apos;s
            official policies and this document differ, the university&apos;s official institutional policies take
            precedence.
          </p>
        </LegalSection>

        <LegalSection id="collect" title="2. Information We Collect">
          <p>
            Information reaches the portal in three ways: (a) what you provide when registering or using the service,
            (b) what authorized faculty and administrators create, and (c) what is generated automatically as you use
            the system.
          </p>

          <p className="font-semibold text-slate-800">2.1 Account and identity information</p>
          <LegalBullets
            items={[
              'Your name and university email address.',
              'A password. Passwords are stored only as a salted bcrypt hash — the portal never stores or displays your password in plain text.',
              'Your Student ID / Roll number (a 16-digit number) and phone number, where the university collects them. Both are unique per account and may be used to sign in.',
              'Your role (student, faculty, or an administrative role) and, for staff, the departments or courses assigned to your account.',
              'Your department, batch and semester.',
            ]}
          />

          <p className="font-semibold text-slate-800 pt-2">2.2 Identity verification information</p>
          <p>
            If the university has enabled the Student ID approval workflow, students who are not automatically approved
            may be asked to upload a photo of their Student ID card. This image, your approval status, and an
            internal review history (who reviewed it and when) are stored. Students registering with an official
            university email address are approved automatically and are not asked for a photo.
          </p>

          <p className="font-semibold text-slate-800 pt-2">2.3 Academic activity and content</p>
          <LegalBullets
            items={[
              'Course materials, notices, assignments and quizzes, and any files uploaded by authorized faculty or administrators.',
              'Your submissions: assignment text and files you upload, quiz/exam answers and results, and any material you submit for review.',
              'Your enrollments, including regular course placement and any approved additional/retake/backlog enrollments.',
              'Bookmarks (saved files) and general activity such as which materials are viewed or downloaded.',
              'Messages you exchange with faculty through the portal, and the content and delivery records of university broadcast emails.',
            ]}
          />

          <p className="font-semibold text-slate-800 pt-2">2.4 Automatically collected and technical information</p>
          <LegalBullets
            items={[
              'Device and browser information (browser type/version and operating system), collected as part of your request to the server and stored in security logs.',
              'IP address, recorded at sign-in and in server logs for security, abuse prevention and troubleshooting.',
              'Secure session information: after you sign in, a signed authentication token and a cached copy of your basic profile are stored in your browser. The portal does not use advertising or third-party tracking cookies; the optional analytics cookie is described in section 7.',
              'Web Push subscription data, if you enable notifications — a browser/device-specific push endpoint and its keys, plus device type and browser, so the portal can deliver notifications to that device.',
              'Analytics information, if the university has enabled analytics for the portal: aggregate usage from Google Analytics 4, and anonymised session recordings, heatmaps and click/navigation insights from Microsoft Clarity. Analytics begins automatically when you use the portal; the portal sends only internal, non-sensitive identifiers and never your name, email, Student ID, password, one-time codes or authentication tokens.',
            ]}
          />

          <p className="font-semibold text-slate-800 pt-2">2.5 Voluntary submissions</p>
          <p>
            If you use the public Feedback form, the name, email address, category, subject, message and optional
            rating you enter are stored so the university can review and respond. Guest participants in a public
            (link-shared) exam may provide a name, email and phone number to receive their result.
          </p>

          <LegalTable
            caption="Summary of collected data and the reason it is collected"
            head={['Category', 'Examples', 'Why']}
            rows={[
              ['Account', 'Name, email, hashed password, role', 'Sign-in and account management'],
              ['Identity', 'Student ID, phone, ID photo', 'Verify university membership'],
              ['Academic', 'Department, batch, semester, enrollments', 'Deliver the right courses and content'],
              ['Content', 'Uploads, submissions, quiz answers', 'Provide assignments, quizzes and materials'],
              ['Communication', 'Messages, notices, broadcast emails', 'Communication between authorized users'],
              ['Technical', 'IP address, device/browser, logs', 'Security, reliability and abuse prevention'],
            ]}
          />
        </LegalSection>

        <LegalSection id="use" title="3. How We Use Information">
          <LegalBullets
            items={[
              'To authenticate you and manage your account, including email verification codes and password resets.',
              'To provide the portal’s academic functionality — course materials, notices, assignments, quizzes and results.',
              'To verify that users are members of the university community.',
              'To manage courses, batches, departments and enrollments.',
              'To enable communication between authorized users, such as faculty–student messaging and notices.',
              'To keep the service secure, prevent fraud and abuse, and enforce access controls.',
              'To monitor reliability and improve performance and the quality of the service.',
              'To send notifications you have opted into, by in-app message, email or browser push.',
            ]}
          />
          <p>
            We do not use your information for advertising, and we do not sell it.
          </p>
        </LegalSection>

        <LegalSection id="sharing" title="4. When Information Is Shared">
          <p>Information is visible only to the people who need it to run the university’s academic processes:</p>
          <LegalBullets
            items={[
              'University administrators and super administrators, who manage users, content and settings.',
              'Authorized faculty and staff, whose visibility is scoped by role and assignment — for example, a faculty member sees the students and courses assigned to them.',
              'Other users, to the limited extent the feature requires — for example, a message you send is visible to its recipient.',
            ]}
          />
          <p className="font-semibold text-slate-800 pt-2">Service providers</p>
          <p>
            The portal uses infrastructure and service providers to operate. Depending on the university’s
            configuration, these may include:
          </p>
          <LegalBullets
            items={[
              'A cloud hosting provider that runs the portal and its database.',
              'A file storage provider for uploaded documents and images (for example local university storage, an S3-compatible object store, or an image/file CDN service).',
              'An email delivery provider used to send verification codes, password-reset links and broadcast emails.',
              'Google Analytics 4 and Microsoft Clarity, if the university enables analytics for the portal. Clarity records anonymised sessions and heatmaps to help us find confusing or broken screens.',
              'The browser push service used to deliver notifications to subscribed devices.',
            ]}
          />
          <p>
            These providers process information only to deliver their service to the university. The portal does not
            sell personal information and does not share it with third parties for their own marketing.
          </p>
          <p>
            Information may also be disclosed where required by law, regulation, or a valid legal request, or where
            necessary to protect the safety, rights or property of the university or its members.
          </p>
        </LegalSection>

        <LegalSection id="storage" title="5. Storage & Security">
          <p>
            We take reasonable technical and organizational measures to protect information. These include:
          </p>
          <LegalBullets
            items={[
              'Password hashing (bcrypt), so passwords are not stored in readable form.',
              'Authentication controls, including signed session tokens that can be invalidated immediately if a password is changed or an account is restricted.',
              'Role-based access control — access to administrative functions and student data is limited by role and permission.',
              'Re-verification of a user’s role and status on every protected request, rather than trusting the session token alone.',
              'Encrypted HTTPS communication between your browser and the portal in production.',
              'Restricted uploads: file type allow-lists and size limits, with randomized internal file names.',
              'Security protections such as security headers, request rate limiting, and input sanitization to reduce common web attacks.',
              'Restricted administrative access and server-side validation of all sensitive actions.',
            ]}
          />
          <LegalCallout tone="warning" title="No system is completely secure">
            <p>
              No method of transmission or storage is perfectly secure, and we cannot guarantee absolute security.
              Please protect your account by using a strong, unique password and not sharing it with anyone.
            </p>
          </LegalCallout>
        </LegalSection>

        <LegalSection id="retention" title="6. Data Retention">
          <p>
            Information is retained only for as long as it is needed for the purposes described in this policy. That
            includes providing the service, academic administration and record-keeping, meeting legal or regulatory
            obligations, resolving disputes, and maintaining security.
          </p>
          <p>
            When information is no longer needed, it is deleted or made anonymous. Some records may be kept longer where
            the university is required or permitted to retain them (for example, official academic records). Because
            retention periods depend on university policy and law, specific periods are not listed here and are set by
            the university.
          </p>
        </LegalSection>

        <LegalSection id="cookies" title="7. Cookies, Local Storage & Analytics">
          <p>
            <strong>Local storage.</strong> The portal does not use advertising or third-party tracking cookies — the one
            optional analytics cookie is described below. After you sign in,
            it stores a signed authentication token and a cached copy of your basic profile in your browser&apos;s local
            storage so you stay signed in and the interface can load quickly. Clearing your browser storage signs you
            out. A service worker may also cache the app’s files so it can load reliably; this cache contains no personal
            data.
          </p>
          <p>
            <strong>Analytics.</strong> If the university configures analytics, the portal uses Google Analytics 4 for
            aggregate usage (such as which pages are visited) and Microsoft Clarity for behavioural analytics —
            anonymised session recordings, heatmaps and click/navigation insights that help us find confusing or broken
            parts of the portal. Both are disabled unless the university sets the matching measurement/project ID, and
            both begin automatically when you use the portal. Clarity sets a first-party cookie. The portal never sends
            names, email addresses, Student IDs, passwords, one-time codes or authentication tokens to analytics, user
            identification uses an internal non-sensitive identifier, and Clarity masks input fields and other sensitive
            content.
          </p>
        </LegalSection>

        <LegalSection id="rights" title="8. Your Rights & Requests">
          <p>Subject to university policy and applicable law, you may request to:</p>
          <LegalBullets
            items={[
              'Access the account and personal information held about you.',
              'Correct information that is inaccurate — much of your profile can be updated yourself from the Profile page.',
              'Request deletion of your account and associated personal data, where the university is not required to retain it.',
              'Ask questions or raise concerns about how your information is handled.',
            ]}
          />
          <p>
            To make a request, contact the university using the details in the
            {' '}
            <a href="#contact" className="text-brand-700 font-medium hover:underline">contact section</a> below. We may
            ask you to verify your identity before acting on a request. Some requests may be limited where the university
            has a legal or academic-record obligation to retain the data.
          </p>
          <p>
            To delete your account, use{' '}
            <Link to="/delete-account" className="text-brand-700 font-medium hover:underline">Delete your account</Link>
            {' '}or the same option on your Profile page inside the app. The page also explains exactly what is removed and
            what the university must keep.
          </p>
        </LegalSection>

        <LegalSection id="children" title="9. Children's Privacy">
          <p>
            The ISU Academic Portal is intended for university students, faculty and staff, who are expected to be adults
            (18 years or older). The portal is not directed at children, and we do not knowingly collect information from
            children.
          </p>
          <p>
            Where a student is under 18 at the time of enrollment, their access and information are managed by the
            university in accordance with its admission and academic policies, and with the involvement of a parent or
            guardian where required. If you believe a child&apos;s information has been provided to the portal without
            appropriate consent, please contact us so it can be addressed.
          </p>
        </LegalSection>

        <LegalSection id="third-party" title="10. Third-Party Services">
          <p>
            Links to external sites or services that may appear in the portal are not covered by this policy, and we are
            not responsible for their privacy practices. We encourage you to review the privacy policy of any external
            service you use.
          </p>
        </LegalSection>

        <LegalSection id="changes" title="11. Changes to This Policy">
          <p>
            This policy may be updated from time to time to reflect changes to the portal, our practices, or legal
            requirements. When it changes, the effective date and the &quot;last updated&quot; date shown at the top of
            this page will be revised. Continued use of the portal after an update means you accept the revised policy.
          </p>
        </LegalSection>

        <LegalSection id="contact" title="12. Contact Us">
          <p>For privacy questions or requests, contact:</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <div>
              <span className="text-sm font-medium text-slate-500">Privacy contact:&nbsp;</span>
              <ConfigValue field={contactEmail} kind="mail" />
            </div>
            {siteConfig.supportEmail.configured && contactEmail !== siteConfig.supportEmail && (
              <div>
                <span className="text-sm font-medium text-slate-500">General support:&nbsp;</span>
                <ConfigValue field={siteConfig.supportEmail} kind="mail" />
              </div>
            )}
          </div>
          {isPlaceholder(contactEmail) && (
            <LegalCallout tone="warning" title="Contact details not yet configured">
              <p>
                The university has not yet provided a public privacy contact address. This placeholder must be replaced
                before the portal is released to the public or published on Google Play.
              </p>
            </LegalCallout>
          )}
        </LegalSection>

        <LegalSection id="acknowledgements" title="Acknowledgements">
          <p>
            All thanks go to the contributors who are giving or uploading files to the platform.
          </p>
        </LegalSection>
      </LegalShell>
    </>
  );
}
