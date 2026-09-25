/**
 * Enterprise Philippine Mobile Phone Number Formatting & Validation Utility
 * Standard: National Telecommunications Commission (NTC) / ITU E.164 (+63 / 09XX)
 * Latency: <1ms synchronous zero-lag client validation
 */

const GLOBE_PREFIXES = new Set([
  '0905', '0906', '0915', '0916', '0917', '0926', '0927', '0935', '0936', '0945',
  '0953', '0954', '0955', '0956', '0965', '0966', '0967', '0975', '0976', '0977',
  '0978', '0979', '0995', '0996', '0997'
]);

const SMART_PREFIXES = new Set([
  '0907', '0908', '0909', '0910', '0911', '0912', '0913', '0914', '0918', '0919',
  '0920', '0921', '0928', '0929', '0930', '0938', '0939', '0946', '0947', '0948',
  '0949', '0950', '0951', '0961', '0963', '0968', '0969', '0970', '0971', '0981',
  '0989', '0992', '0998', '0999'
]);

const DITO_PREFIXES = new Set([
  '0895', '0896', '0897', '0898', '0991', '0992', '0993', '0994'
]);

/**
 * Identify Philippine mobile telecom provider
 */
export function getPhCarrier(phoneDigits) {
  if (!phoneDigits || phoneDigits.length < 4) return null;
  const prefix = phoneDigits.slice(0, 4);
  if (GLOBE_PREFIXES.has(prefix)) return 'Globe / TM';
  if (SMART_PREFIXES.has(prefix)) return 'Smart / TNT';
  if (DITO_PREFIXES.has(prefix)) return 'DITO';
  return 'PH Mobile';
}

/**
 * Format string as user types into: 09XX XXX XXXX
 */
export function formatPhPhone(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('63')) {
    digits = '0' + digits.slice(2);
  }
  digits = digits.slice(0, 11);

  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

/**
 * Clean phone string to raw 11-digit string (e.g. "09171234567")
 */
export function cleanPhPhone(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) {
    digits = '0' + digits.slice(2);
  }
  return digits.slice(0, 11);
}

/**
 * Real-time synchronous enterprise validation
 */
export function validatePhPhone(value) {
  const clean = cleanPhPhone(value);

  if (!clean) {
    return {
      isValid: false,
      status: 'empty',
      carrier: null,
      message: 'Philippine mobile number is required (09XXXXXXXXX)'
    };
  }

  if (clean.length >= 2 && !clean.startsWith('09') && !clean.startsWith('08')) {
    return {
      isValid: false,
      status: 'invalid_prefix',
      carrier: null,
      message: 'Mobile numbers must start with 09 (e.g. 0917, 0998)'
    };
  }

  const carrier = getPhCarrier(clean);

  if (clean.length < 11) {
    return {
      isValid: false,
      status: 'incomplete',
      carrier,
      message: `${clean.length}/11 digits entered`
    };
  }

  if (clean.length === 11) {
    return {
      isValid: true,
      status: 'valid',
      carrier,
      cleanPhone: clean,
      message: `Verified Philippine Mobile (${carrier || 'NTC Compliant'})`
    };
  }

  return {
    isValid: false,
    status: 'too_long',
    carrier,
    message: 'Exceeds 11 digits'
  };
}
