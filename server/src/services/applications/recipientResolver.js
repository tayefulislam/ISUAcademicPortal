import ApplicationRecipient from '../../models/ApplicationRecipient.js';
import Department from '../../models/Department.js';
import User from '../../models/User.js';
import { ApiError } from '../../utils/ApiError.js';

// Which official recipient an application may be addressed to, and the exact
// block that prints on the letter. Admin-managed data only — the AI is never
// asked for a name, designation or address.

/** The recipient picker: active records, with other departments' HODs hidden. */
export async function listRecipientsFor(user) {
  const recipients = await ApplicationRecipient.find({ active: true })
    .sort({ order: 1, name: 1 })
    .lean();

  return recipients
    .filter((recipient) => {
      if (recipient.type !== 'HOD' || !recipient.department) return true;
      return Boolean(user?.department) && String(recipient.department) === String(user.department);
    })
    .map(toOption);
}

export function toOption(recipient) {
  return {
    _id: String(recipient._id),
    name: recipient.name,
    designation: recipient.designation || '',
    office: recipient.office || '',
    type: recipient.type,
    department: recipient.department ? String(recipient.department) : null,
  };
}

/**
 * Validates the chosen recipient and resolves the block that goes on the letter.
 *
 * <p>For a Head of Department, the department's own `head` (when one is on file)
 * supplies the name and designation — so "Head of Department" always means the
 * actual HOD of the applicant's department, and never a guess.
 *
 * @returns {Promise<object>} the recipient snapshot stored on the Application
 */
export async function resolveRecipient(user, recipientId) {
  if (!recipientId) {
    throw new ApiError(422, 'Please choose a recipient', null, 'RECIPIENT_INVALID');
  }
  const recipient = await ApplicationRecipient.findById(recipientId).lean();
  if (!recipient || !recipient.active) {
    throw new ApiError(422, 'That recipient is not available', null, 'RECIPIENT_INVALID');
  }
  // A department-scoped HOD record belongs to one department only.
  if (
    recipient.type === 'HOD'
    && recipient.department
    && (!user?.department || String(recipient.department) !== String(user.department))
  ) {
    throw new ApiError(403, 'You cannot address that department', null, 'RECIPIENT_INVALID');
  }

  const snapshot = {
    recipient: String(recipient._id),
    name: recipient.name || '',
    designation: recipient.designation || '',
    office: recipient.office || '',
    address: recipient.address || '',
    type: recipient.type,
    letterhead: {
      universityName: recipient.letterhead?.universityName || '',
      addressLine: recipient.letterhead?.addressLine || '',
      footer: recipient.letterhead?.footer || '',
    },
  };

  if (recipient.type === 'HOD' && user?.department) {
    const department = await Department.findById(user.department).select('name code head').lean();
    if (department) {
      if (!snapshot.office) snapshot.office = `Department of ${department.name}`;
      if (department.head) {
        const head = await User.findById(department.head).select('name designation').lean();
        if (head) {
          if (head.name) snapshot.name = head.name;
          if (head.designation) snapshot.designation = head.designation;
        }
      }
    }
  }

  return snapshot;
}

/** The "To" block, as label/value rows, for the preview. */
export function recipientRows(snapshot) {
  if (!snapshot) return [];
  const rows = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') rows.push({ label, value: String(value) });
  };
  add('Recipient', snapshot.name);
  add('Designation', snapshot.designation);
  add('Office', snapshot.office);
  add('Address', snapshot.address);
  return rows;
}

/** The same block as plain text for the AI prompt. */
export function recipientText(snapshot) {
  return recipientRows(snapshot)
    .map((row) => `${row.label}: ${row.value}`)
    .join('\n');
}

export default {
  listRecipientsFor,
  resolveRecipient,
  toOption,
  recipientRows,
  recipientText,
};
