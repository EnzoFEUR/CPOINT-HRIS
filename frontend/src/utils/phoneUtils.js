/**
 * Enterprise Philippine Mobile Phone Number Formatting & Validation Utility
 * Standard: National Telecommunications Commission (NTC) / ITU E.164 (+63 9XX XXX XXXX)
 * Latency: <1ms synchronous zero-lag client validation
 */

const GLOBE_PREFIXES = new Set([
  '905', '906', '915', '916', '917', '925', '926', '927', '935', '936', '937', '945',
  '953', '954', '955', '956', '965', '966', '967', '975', '976', '977',
  '978', '979', '995', '996', '997'
]);

const SMART_PREFIXES = new Set([
  '907', '908', '909', '910', '911', '912', '913', '914', '918', '919',
  '920', '921', '928', '929', '930', '938', '939', '946', '947', '948',
  '949', '950', '951', '961', '963', '968', '969', '970', '971', '981',
  '989', '992', '998', '999'
]);

const DITO_PREFIXES = new Set([
  '895', '896', '897', '898', '991', '992', '993', '994'
]);

/**
 * Clean phone string to raw 10-digit string starting with 9 or 8 (without leading 0 or 63)
 * Strips non-digits, leading +63 / 63, and leading 0.
 * Example inputs: "0917 123 4567", "+639171234567", "9171234567" -> "9171234567"
 */
export function cleanPhDigits(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('63')) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, '');
  return digits.slice(0, 10);
}

/**
 * Alias for cleanPhDigits
 */
export function cleanPhPhone(value) {
  return cleanPhDigits(value);
}

/**
 * Identify Philippine mobile telecom provider
 */
export function getPhCarrier(value) {
  const digits = cleanPhDigits(value);
  if (!digits || digits.length < 3) return null;
  const prefix = digits.slice(0, 3);
  if (GLOBE_PREFIXES.has(prefix)) return 'Globe / TM';
  if (SMART_PREFIXES.has(prefix)) return 'Smart / TNT';
  if (DITO_PREFIXES.has(prefix)) return 'DITO';
  if (prefix.startsWith('9') || prefix.startsWith('8')) return 'PH Mobile';
  return null;
}

/**
 * Format string as user types in inputs where +63 is prefixed: 9XX XXX XXXX (10 digits)
 * Automatically strips leading 0 so the user never enters a redundant 0 beside +63.
 */
export function formatPhPhone(value) {
  if (!value) return '';
  const digits = cleanPhDigits(value);
  if (!digits) return '';

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
}

/**
 * Format phone string for read-only enterprise display: +63 9XX XXX XXXX
 * Accepts any raw phone format (10-digit, 11-digit with 0, or E.164 with +63).
 */
export function formatPhDisplay(value) {
  if (!value) return '';
  const digits = cleanPhDigits(value);
  if (!digits) {
    const raw = String(value).trim();
    return raw.toLowerCase() === 'n/a' ? '' : raw;
  }
  if (digits.length <= 3) return `+63 ${digits}`;
  if (digits.length <= 6) return `+63 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `+63 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
}

/**
 * Convert to standard international ITU-T E.164 (+639XXXXXXXXX)
 */
export function toPhE164(value) {
  const digits = cleanPhDigits(value);
  return digits ? `+63${digits}` : null;
}

/**
 * Real-time synchronous enterprise validation (10-digit format starting with 9 or 8)
 */
export function validatePhPhone(value) {
  const clean = cleanPhDigits(value);

  if (!clean) {
    return {
      isValid: false,
      status: 'empty',
      carrier: null,
      message: 'Philippine mobile number is required (9XXXXXXXXX)'
    };
  }

  if (!clean.startsWith('9') && !clean.startsWith('8')) {
    return {
      isValid: false,
      status: 'invalid_prefix',
      carrier: null,
      message: 'Mobile numbers must start with 9 (e.g. 917 123 4567)'
    };
  }

  const carrier = getPhCarrier(clean);

  if (clean.length < 10) {
    return {
      isValid: false,
      status: 'incomplete',
      carrier,
      message: `${clean.length}/10 digits entered`
    };
  }

  if (clean.length === 10) {
    return {
      isValid: true,
      status: 'valid',
      carrier,
      cleanPhone: clean,
      e164: `+63${clean}`,
      formatted: `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`,
      fullDisplay: `+63 ${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`,
      message: `Verified Philippine Mobile (${carrier || 'NTC Compliant'})`
    };
  }

  return {
    isValid: false,
    status: 'too_long',
    carrier,
    message: 'Exceeds 10 digits'
  };
}
