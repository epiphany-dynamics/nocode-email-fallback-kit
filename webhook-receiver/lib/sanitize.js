/**
 * Payload normalization + sanitization for inbound form-submission webhooks.
 *
 * No-code platforms are inconsistent about how they shape outbound webhook
 * payloads: field names vary ("name" vs "full_name" vs "Name"), missing
 * fields might arrive as empty strings, `null`, or simply be absent, and
 * free-text fields can contain raw HTML/script content that must never be
 * interpolated unescaped into an email body.
 *
 * This module has no external dependencies on purpose: it's the one part of
 * the pipeline that touches untrusted input directly, so it stays small and
 * auditable.
 */

// Common aliases seen across no-code platforms for the same logical field.
// Add to these lists as new platforms/quirks are encountered.
const FIELD_ALIASES = {
  name: ['name', 'full_name', 'fullName', 'Name', 'contact_name', 'first_name'],
  email: ['email', 'Email', 'email_address', 'emailAddress', 'contact_email'],
  phone: ['phone', 'Phone', 'phone_number', 'phoneNumber', 'contact_phone'],
  message: ['message', 'Message', 'body', 'comments', 'details', 'inquiry'],
  subject: ['subject', 'Subject', 'topic', 'form_name', 'formName'],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * HTML-escape a string so it is safe to interpolate into an HTML email body.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip control characters and collapse excessive whitespace from
 * free-text input. Intentionally conservative: this is display sanitization,
 * not a full profanity/spam filter.
 * @param {unknown} value
 * @returns {string}
 */
function cleanText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

/**
 * Look up the first present, non-empty value across a list of aliased keys.
 * @param {Record<string, unknown>} payload
 * @param {string[]} aliases
 * @returns {string}
 */
function pickAliased(payload, aliases) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const raw = payload[key];
      const cleaned = cleanText(raw);
      if (cleaned.length > 0) return cleaned;
    }
  }
  return '';
}

/**
 * Normalize an arbitrary, platform-specific form-submission payload into a
 * consistent shape, and flag validation problems instead of throwing, so
 * the caller can decide how to respond (e.g. still 200 the webhook so the
 * no-code platform doesn't retry-storm, while logging the rejection).
 *
 * @param {unknown} rawPayload
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   data: {
 *     name: string,
 *     email: string,
 *     phone: string,
 *     subject: string,
 *     message: string,
 *     extra: Record<string, string>
 *   }
 * }}
 */
function normalizeSubmission(rawPayload) {
  const errors = [];

  if (rawPayload === null || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      valid: false,
      errors: ['payload must be a JSON object'],
      data: { name: '', email: '', phone: '', subject: '', message: '', extra: {} },
    };
  }

  const payload = /** @type {Record<string, unknown>} */ (rawPayload);

  const name = pickAliased(payload, FIELD_ALIASES.name);
  const email = pickAliased(payload, FIELD_ALIASES.email);
  const phone = pickAliased(payload, FIELD_ALIASES.phone);
  const subject = pickAliased(payload, FIELD_ALIASES.subject) || 'New website form submission';
  const message = pickAliased(payload, FIELD_ALIASES.message);

  if (!email) {
    errors.push('missing required field: email (or an alias of it)');
  } else if (!EMAIL_RE.test(email)) {
    errors.push(`email field does not look like a valid address: "${email}"`);
  }

  if (!name && !message) {
    errors.push('payload has neither a name nor a message field; likely not a real form submission');
  }

  // Anything not mapped to a known field is preserved (cleaned, capped) so
  // it can still be surfaced in the notification email without ever being
  // trusted as one of the primary fields.
  const knownKeys = new Set(Object.values(FIELD_ALIASES).flat());
  /** @type {Record<string, string>} */
  const extra = {};
  for (const [key, value] of Object.entries(payload)) {
    if (knownKeys.has(key)) continue;
    if (typeof value === 'object' && value !== null) continue; // skip nested structures
    const cleaned = cleanText(value);
    if (cleaned.length === 0) continue;
    extra[key] = cleaned.slice(0, 500);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name: name.slice(0, 200),
      email: email.slice(0, 320),
      phone: phone.slice(0, 50),
      subject: subject.slice(0, 200),
      message: message.slice(0, 5000),
      extra,
    },
  };
}

module.exports = {
  normalizeSubmission,
  escapeHtml,
  cleanText,
  FIELD_ALIASES,
};
