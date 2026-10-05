/**
 * Personal Details Validation and Sanitization
 * Enterprise-grade security for PII (Address, Birth Date, Gender)
 */

export const ALLOWED_GENDERS = ['Male', 'Female','Other', 'Prefer not to say'];

/**
 * Validates and normalizes gender against the strict enterprise whitelist.
 * Returns normalized string (Title Case) or null if invalid/empty.
 */
export function sanitizeGender(gender) {
    if (!gender || typeof gender !== 'string') return null;
    const trimmed = gender.trim();
    if (!trimmed || trimmed.toUpperCase() === 'N/A') return null;

    const matched = ALLOWED_GENDERS.find(g => g.toLowerCase() === trimmed.toLowerCase());
    return matched || null;
}

/**
 * Validates birth date according to ISO 8601 YYYY-MM-DD format
 * Enforces Philippine DOLE minimum working age (15 years) and max reasonable age (100 years).
 * Returns { isValid: boolean, error?: string, birthDate?: string, age?: number }
 */
export function validateBirthDate(birthDateStr) {
    if (!birthDateStr) return { isValid: true, birthDate: null };
    if (typeof birthDateStr !== 'string') return { isValid: false, error: 'Invalid birth date format.' };

    const trimmed = birthDateStr.trim();
    if (!trimmed || trimmed.toUpperCase() === 'N/A') return { isValid: true, birthDate: null };

    // Match YYYY-MM-DD format strictly
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateRegex.test(trimmed)) {
        return { isValid: false, error: 'Birth date must be in YYYY-MM-DD format.' };
    }

    const birthDate = new Date(trimmed + 'T00:00:00Z');
    if (isNaN(birthDate.getTime())) {
        return { isValid: false, error: 'Invalid calendar date.' };
    }

    const today = new Date();
    // Check if future date
    if (birthDate > today) {
        return { isValid: false, error: 'Birth date cannot be in the future.' };
    }

    // Calculate age precisely
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - birthDate.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birthDate.getUTCDate())) {
        age--;
    }

    if (age < 15) {
        return { 
            isValid: false, 
            error: 'Employee must be at least 15 years old per Philippine DOLE Labor Standards (R.A. 9231).' 
        };
    }

    if (age > 100) {
        return { isValid: false, error: 'Employee age cannot exceed 100 years.' };
    }

    return { isValid: true, birthDate: trimmed, age };
}

/**
 * Sanitizes and secures residential address to prevent XSS, HTML injection,
 * and malicious scripts while retaining valid address punctuation.
 * Bounds to maximum 300 characters.
 */
export function sanitizeAddress(addressStr) {
    if (!addressStr || typeof addressStr !== 'string') return null;

    let sanitized = addressStr
        // Remove script tags and content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Strip HTML tags
        .replace(/<[^>]+>/g, '')
        // Strip javascript:, data:, vbscript: protocols
        .replace(/(javascript|vbscript|data):/gi, '')
        // Normalize control and non-printable characters except standard newlines and spaces
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Normalize multiple spaces/newlines
        .replace(/\s+/g, ' ')
        .trim();

    if (!sanitized) return null;

    // Limit length to 300 characters
    if (sanitized.length > 300) {
        sanitized = sanitized.substring(0, 300).trim();
    }

    return sanitized;
}
