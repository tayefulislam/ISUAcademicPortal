import { FileText } from 'lucide-react';
import Seo from '../../components/Seo.jsx';
import LegalShell, { LegalSection, LegalBullets, LegalCallout } from '../../components/legal/LegalShell.jsx';
import ConfigValue from '../../components/legal/ConfigValue.jsx';
import { siteConfig, isPlaceholder } from '../../config/site.js';

const SECTIONS = [
  { id: 'acceptance', label: '1. Acceptance of These Terms' },
  { id: 'service', label: '2. About the Service' },
  { id: 'acceptable-use', label: '3. Acceptable Use' },
  { id: 'academic-content', label: '4. Academic Content' },
  { id: 'accounts', label: '5. Accounts & Security' },
  { id: 'uploads', label: '6. Uploaded Content' },
  { id: 'availability', label: '7. Availability of the Service' },
  { id: 'external', label: '8. External Services' },
  { id: 'intellectual-property', label: '9. Intellectual Property' },
  { id: 'suspension', label: '10. Suspension & Termination' },
  { id: 'disclaimer', label: '11. Disclaimers' },
  { id: 'changes', label: '12. Changes to These Terms' },
  { id: 'contact', label: '13. Contact' },
];

export default function Terms() {
  const contactEmail = siteConfig.legalEmail.configured ? siteConfig.legalEmail : siteConfig.supportEmail;

  return (
    <>
      <Seo
        title="Terms of Service | ISU Academic Portal"
        description="The terms that govern use of the ISU Academic Portal by students, faculty and staff."
        path="/terms"
        robots="index, follow"
      />

      <LegalShell
        title="Terms of Service"
        icon={FileText}
        intro="These Terms of Service set out the rules for using the ISU Academic Portal. By creating an account or using the portal, you agree to follow them."
        metaRows={[
          { label: 'Effective date', value: siteConfig.effectiveDate },
          { label: 'Last updated', value: siteConfig.lastUpdated },
          { label: 'Version', value: siteConfig.policyVersion },
        ]}
        sections={SECTIONS}
      >
        <LegalSection id="acceptance" title="1. Acceptance of These Terms">
          <p>
            These Terms apply to everyone who accesses the ISU Academic Portal, including students, faculty and staff,
            whether through a web browser or the Android app. If you do not agree with these Terms, you should not use
            the portal.
          </p>
          <p>
            These Terms are used together with the university&apos;s official academic and conduct policies. The portal
            does not replace those policies; where there is a conflict, the university&apos;s official policies apply.
          </p>
        </LegalSection>

        <LegalSection id="service" title="2. About the Service">
          <p>
            The ISU Academic Portal is provided by {siteConfig.universityName.configured ? siteConfig.universityName.value : 'the university'} to help members of
            the university community access course materials, notices, assignments, quizzes and related academic
            services, and to allow faculty and administrators to manage them.
          </p>
          <p>
            Access is limited to authorized members of the university community. Access to specific content may depend on
            your role, department, batch, semester and enrollment.
          </p>
        </LegalSection>

        <LegalSection id="acceptable-use" title="3. Acceptable Use">
          <p>When using the portal, you must:</p>
          <LegalBullets
            items={[
              'Use only your own authorized account.',
              'Provide accurate, current and complete information, and keep it up to date.',
              'Respect the rights and privacy of other students, faculty and staff.',
              'Follow all applicable university rules, academic integrity policies and the law.',
            ]}
          />
          <p>You must not:</p>
          <LegalBullets
            items={[
              'Attempt to access an account, data or area of the portal you are not authorized to access.',
              'Abuse, disrupt or interfere with the operation of the portal or the systems that support it.',
              'Upload viruses, malware or any other harmful or malicious files.',
              'Impersonate another student, faculty or staff member, or misrepresent your identity.',
              'Use the portal to harass, threaten or harm others, or to send unwanted content.',
              'Misuse or redistribute academic materials in a way that breaches copyright or university rules.',
              'Use automated tools to scrape, overload or attack the service.',
            ]}
          />
          <LegalCallout tone="info" title="Academic integrity">
            <p>
              Misuse of the portal may also be treated as a breach of university conduct rules, which can have
              academic consequences independent of these Terms.
            </p>
          </LegalCallout>
        </LegalSection>

        <LegalSection id="academic-content" title="4. Academic Content">
          <LegalBullets
            items={[
              'Course materials, notices, assignments, quizzes and other academic content may be provided by authorized university personnel.',
              'Academic content is provided for your own study and use as part of your enrollment, and remains the property of the university or the person or organization that created it.',
              'You must follow the university’s academic rules when using this content.',
              'The portal is a tool for managing academic content; it does not replace official university policies, formal results or official notices.',
              'Grades and results shown in the portal may be provisional and may be corrected or updated by the university.',
            ]}
          />
        </LegalSection>

        <LegalSection id="accounts" title="5. Accounts & Security">
          <LegalBullets
            items={[
              'You are responsible for keeping your password confidential and for activity that happens through your account.',
              'You should choose a strong password and must not share your account with anyone else.',
              'You should tell the university promptly if you believe your account has been used without your permission.',
              'Accounts may be restricted, suspended or blocked if these Terms or university rules are breached, or to protect the security of the portal.',
              'University administrators may create, manage, approve or modify academic accounts as required for the operation of the university.',
            ]}
          />
        </LegalSection>

        <LegalSection id="uploads" title="6. Uploaded Content">
          <p>If you upload content — for example a Student ID photo, an assignment submission or a document — you agree that:</p>
          <LegalBullets
            items={[
              'You will only upload content that you are authorized to share, and that relates to your legitimate academic use of the portal.',
              'You will not upload unlawful, harmful, offensive or malicious content, or content that infringes another person’s rights.',
              'Uploaded files are subject to file type and size limits and may be reviewed by authorized faculty or administrators.',
              'The university may remove content that is inappropriate, unlawful, or that breaches these Terms or university policy.',
              'Content you submit through academic features may be visible to the relevant faculty, reviewers and administrators as part of grading, review or administration.',
            ]}
          />
        </LegalSection>

        <LegalSection id="availability" title="7. Availability of the Service">
          <LegalCallout tone="warning" title="No guarantee of uninterrupted service">
            <p>
              The portal is provided on an &quot;as available&quot; basis. We do not guarantee that it will always be
              available or error-free. Access may be interrupted or unavailable from time to time due to scheduled or
              emergency maintenance, technical problems, network or hosting issues, or events outside our control.
            </p>
          </LegalCallout>
          <p>
            The university may also change, add to, or remove features of the portal when necessary. Where a change
            materially affects your use, the university will take reasonable steps to communicate it in good time.
          </p>
        </LegalSection>

        <LegalSection id="external" title="8. External Services">
          <p>
            To operate, the portal relies on services provided by third parties. Depending on the university&apos;s
            configuration, these may include cloud hosting, a database service, file storage (such as an object store,
            image or file CDN), an email delivery service, analytics, and the browser push service used for
            notifications.
          </p>
          <p>
            These services support the functions described in our{' '}
            <a href="/privacy-policy" className="text-brand-700 font-medium hover:underline">Privacy Policy</a>, and
            their role is limited to delivering the portal to you. The portal may also contain links to external
            websites; we are not responsible for the content or practices of those sites.
          </p>
        </LegalSection>

        <LegalSection id="intellectual-property" title="9. Intellectual Property">
          <p>
            The portal and its content — including academic materials — are protected by the university&apos;s rights and
            the rights of their respective owners. You may use them only for your own academic purposes. You may not
            copy, publish, distribute or sell them without permission from the university or the rights holder.
          </p>
        </LegalSection>

        <LegalSection id="suspension" title="10. Suspension & Termination">
          <p>
            The university may suspend or terminate your access to the portal, temporarily or permanently, if you breach
            these Terms or university policy, if required by law, or to protect the security and integrity of the
            service.
          </p>
        </LegalSection>

        <LegalSection id="disclaimer" title="11. Disclaimers">
          <p>
            The portal is provided as a service to the university community. While we take reasonable care to keep it
            accurate, secure and available, it is provided without warranties of any kind to the extent permitted by law.
            The university is not responsible for any loss arising from your use of, or inability to use, the portal,
            except where the law provides otherwise.
          </p>
          <p>
            Nothing in these Terms removes or limits any rights you have under applicable law or under the
            university&apos;s official policies.
          </p>
        </LegalSection>

        <LegalSection id="changes" title="12. Changes to These Terms">
          <p>
            We may update these Terms when necessary — for example, to reflect changes to the service or to legal
            requirements. When they change, the effective date and &quot;last updated&quot; date at the top of this page
            will be revised. Continued use of the portal after an update means you accept the revised Terms.
          </p>
        </LegalSection>

        <LegalSection id="contact" title="13. Contact">
          <p>Questions about these Terms can be sent to:</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <div>
              <span className="text-sm font-medium text-slate-500">Terms contact:&nbsp;</span>
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
                The university has not yet provided a public contact address for these Terms. This placeholder must be
                replaced before public release.
              </p>
            </LegalCallout>
          )}
        </LegalSection>
      </LegalShell>
    </>
  );
}
