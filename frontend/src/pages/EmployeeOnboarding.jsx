import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { formatPhPhone, validatePhPhone } from '../utils/phoneUtils';
import { isMedicalExempt } from '../routes/guards';
import { needsProfileCompletion } from '../utils/userAccess.mjs';
import { getStoredUser } from '../utils/storedUser.mjs';
import { performLogout, broadcastAuthChange } from '../utils/authSession';
import PhilippineAddressSelector from '../components/PhilippineAddressSelector';
import { sanitizePersonnelText, isValidPersonnelText, MAX_EMERGENCY_CONTACT_NAME_LENGTH } from '../../../shared/personnelInput.mjs';

const SEX_OPTIONS = ['Male', 'Female'];
const RELATIONSHIP_OPTIONS = [
  'Spouse',
  'Parent',
  'Sibling',
  'Child',
  'Guardian',
  'Relative',
  'Friend / Partner',
  'Other'
];

export default function EmployeeOnboarding() {
  const navigate = useNavigate();
  const [user, setUser] = useState(getStoredUser);
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Mobile & Personal Profile
  const [phone, setPhone] = useState(() => formatPhPhone(user?.phone || ''));
  const [birthDate, setBirthDate] = useState(() => user?.birth_date || '');
  const [sex, setSex] = useState(() => user?.sex || user?.gender || 'Male');

  // Step 2: Residential Address
  const [address, setAddress] = useState(() => user?.address || '');

  // Step 3: Emergency Contact
  const [emergencyName, setEmergencyName] = useState(() => user?.emergency_contact_name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(() => formatPhPhone(user?.emergency_contact_phone || ''));
  const [emergencyRelationship, setEmergencyRelationship] = useState(() => user?.emergency_contact_relationship || 'Parent');

  useEffect(() => {
    let isMounted = true;
    const parsed = getStoredUser();
    if (!parsed) {
      navigate('/login', { replace: true });
      return;
    }
    try {
      // If local storage user profile is already fully complete, immediately advance to biometric setup or portal
      if (!needsProfileCompletion(parsed)) {
        const needsBio = !parsed.has_registered_biometrics && !parsed.biometric_baseline_path && !isMedicalExempt(parsed);
        if (needsBio) {
          navigate('/biometric-setup', { replace: true });
          return;
        } else {
          navigate('/employee/dashboard', { replace: true });
          return;
        }
      }
    } catch {
      navigate('/login', { replace: true });
      return;
    }

    // Enterprise fallback: Fetch authoritative backend profile to verify completeness and heal stale session
    fetchWithAuth('/api/profile')
      .then(res => res.json())
      .then(data => {
        if (!isMounted || !data?.success) return;
        const profile = data.user || data.employee;
        if (!profile) return;
        const merged = { ...parsed, ...profile };
        localStorage.setItem('user', JSON.stringify(merged));
        setUser(merged);
        if (profile.phone) setPhone(formatPhPhone(profile.phone));
        if (profile.birth_date) setBirthDate(profile.birth_date);
        if (profile.sex || profile.gender) setSex(profile.sex || profile.gender);
        if (profile.address) setAddress(profile.address);
        if (profile.emergency_contact_name) setEmergencyName(profile.emergency_contact_name);
        if (profile.emergency_contact_phone) setEmergencyPhone(formatPhPhone(profile.emergency_contact_phone));
        if (profile.emergency_contact_relationship) setEmergencyRelationship(profile.emergency_contact_relationship);

        if (!needsProfileCompletion(merged)) {
          const needsBio = !merged.has_registered_biometrics && !merged.biometric_baseline_path && !isMedicalExempt(merged);
          if (needsBio) {
            navigate('/biometric-setup', { replace: true });
          } else {
            navigate('/employee/dashboard', { replace: true });
          }
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const phoneValidation = useMemo(() => validatePhPhone(phone), [phone]);
  const emergencyPhoneValidation = useMemo(() => validatePhPhone(emergencyPhone), [emergencyPhone]);

  const maxBirthDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 15);
    return d.toISOString().split('T')[0];
  }, []);

  const minBirthDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 100);
    return d.toISOString().split('T')[0];
  }, []);

  const calculateAge = (dateStr) => {
    if (!dateStr) return null;
    const b = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(b.getTime())) return null;
    const today = new Date();
    let age = today.getUTCFullYear() - b.getUTCFullYear();
    const m = today.getUTCMonth() - b.getUTCMonth();
    if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) {
      age--;
    }
    return age;
  };

  const calculatedAge = useMemo(() => calculateAge(birthDate), [birthDate]);

  // Validation per step
  const isStep1Valid = useMemo(() => {
    if (!phoneValidation.isValid) return false;
    if (!birthDate) return false;
    if (calculatedAge === null || calculatedAge < 15 || calculatedAge > 100) return false;
    if (!sex) return false;
    return true;
  }, [phoneValidation.isValid, birthDate, calculatedAge, sex]);

  const isStep2Valid = useMemo(() => {
    if (!address || address.trim().length < 8) return false;
    return true;
  }, [address]);

  const isStep3Valid = useMemo(() => {
    if (!emergencyName || emergencyName.trim().length < 2 || !isValidPersonnelText(emergencyName, 'emergency_contact_name')) return false;
    if (!emergencyPhoneValidation.isValid) return false;
    if (!emergencyRelationship) return false;
    return true;
  }, [emergencyName, emergencyPhoneValidation.isValid, emergencyRelationship]);

  const handleNextStep1 = (e) => {
    e.preventDefault();
    setError(null);
    if (!isStep1Valid) {
      if (!phoneValidation.isValid) {
        setError('Please enter a valid 10-digit Philippine mobile phone number starting with 9.');
        return;
      }
      if (!birthDate || calculatedAge < 15) {
        setError('DOLE Labor Standards require employees to be at least 15 years old.');
        return;
      }
      if (!sex) {
        setError('Please select your sex (Male or Female).');
        return;
      }
      setError('Please complete all required fields in Step 1.');
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = (e) => {
    e.preventDefault();
    setError(null);
    if (!isStep2Valid) {
      setError('Please provide your complete residential address (at least 8 characters).');
      return;
    }
    setStep(3);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!isStep1Valid) {
      setError('Please verify your mobile and profile details in Step 1.');
      setStep(1);
      return;
    }

    if (!isStep2Valid) {
      setError('Please verify your residential address in Step 2.');
      setStep(2);
      return;
    }

    if (!isStep3Valid) {
      if (!emergencyName || emergencyName.trim().length < 2 || !isValidPersonnelText(emergencyName, 'emergency_contact_name')) {
        setError(`Enter a contact name using letters and normal name punctuation, up to ${MAX_EMERGENCY_CONTACT_NAME_LENGTH} characters.`);
        return;
      }
      if (!emergencyPhoneValidation.isValid) {
        setError('Please enter a valid 10-digit mobile number for your emergency contact.');
        return;
      }
      setError('Please complete all emergency contact fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        phone: phoneValidation.cleanPhone,
        birth_date: birthDate,
        sex: sex,
        gender: sex,
        address: address.trim(),
        emergency_contact_name: emergencyName.trim(),
        emergency_contact_phone: emergencyPhoneValidation.cleanPhone,
        emergency_contact_relationship: emergencyRelationship
      };

      const res = await fetchWithAuth('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to save employee profile.');
      }

      // Update local storage session
      const stored = localStorage.getItem('user');
      const currentUser = stored ? JSON.parse(stored) : {};
      const updatedUser = {
        ...currentUser,
        phone: payload.phone,
        birth_date: payload.birth_date,
        sex: payload.sex,
        gender: payload.gender,
        address: payload.address,
        emergency_contact_name: payload.emergency_contact_name,
        emergency_contact_phone: payload.emergency_contact_phone,
        emergency_contact_relationship: payload.emergency_contact_relationship
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      try {
        broadcastAuthChange(updatedUser);
      } catch { /* A cross-tab notification failure must not undo a saved profile. */ }

      const needsBio = !updatedUser.has_registered_biometrics && !updatedUser.biometric_baseline_path && !isMedicalExempt(updatedUser);

      if (needsBio) {
        toast.success('Profile onboarded successfully. Proceeding to Biometrics setup.');
        navigate('/biometric-setup', { replace: true });
      } else {
        toast.success('Onboarding complete. Welcome to C-Point.');
        navigate('/employee/dashboard', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred while saving your profile.');
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await performLogout('/login');
  };

  if (!user) return null;

  return (
    <div className="bg-slate-50 min-h-screen flex items-center justify-center p-4 relative overflow-hidden select-none font-sans">
      <div className="w-full max-w-[500px] relative z-10 bg-white border border-slate-200 p-6 sm:p-7 rounded-lg shadow-xl">
        {/* Brand Header */}
        <div className="text-center mb-5 sm:mb-6">
          <div className="flex items-center justify-center mb-4">
            <picture>
              <source srcSet="/logo-dark.webp" type="image/webp" />
              <img
                src="/logo-dark.png"
                alt="C-Point HRIS"
                width="200"
                height="44"
                decoding="async"
                className="h-10 sm:h-11 w-auto max-w-[200px] object-contain select-none pointer-events-none"
              />
            </picture>
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Employee Onboarding</h2>
          <p className="text-slate-500 mt-1 text-xs">
            Welcome, <span className="font-semibold text-slate-800">{user.first_name || user.name || 'Employee'}</span>. Please complete your personnel record to activate your workforce profile.
          </p>
        </div>

        {/* 3-Step Progress Indicator */}
        <div className="mb-5 bg-slate-50 p-2.5 rounded-md border border-slate-200/80">
          <div className="flex items-center justify-between text-xs font-semibold mb-2">
            <span className={`flex items-center gap-1.5 transition-colors ${step === 1 ? 'text-slate-900 font-bold' : step > 1 ? 'text-emerald-700' : 'text-slate-400'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 1 ? 'bg-slate-900 text-white' : step > 1 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                {step > 1 ? <i className="ti ti-check" /> : '1'}
              </span>
              <span className="hidden sm:inline">1. Mobile</span>
              <span className="sm:hidden">1. Phone</span>
            </span>

            <span className={`flex items-center gap-1.5 transition-colors ${step === 2 ? 'text-slate-900 font-bold' : step > 2 ? 'text-emerald-700' : 'text-slate-400'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 2 ? 'bg-slate-900 text-white' : step > 2 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                {step > 2 ? <i className="ti ti-check" /> : '2'}
              </span>
              <span>2. Address</span>
            </span>

            <span className={`flex items-center gap-1.5 transition-colors ${step === 3 ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 3 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'}`}>
                3
              </span>
              <span className="hidden sm:inline">3. Emergency</span>
              <span className="sm:hidden">3. Contact</span>
            </span>
          </div>

          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-slate-900 h-full transition-all duration-300"
              style={{ width: step === 1 ? '33.33%' : step === 2 ? '66.66%' : '100%' }}
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-danger-subtle text-danger-ink rounded-md text-xs font-medium flex items-center gap-2 border border-danger/20">
            <i className="ti ti-alert-circle text-base shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Mobile Phone Number & Personal Profile */}
        {step === 1 && (
          <form onSubmit={handleNextStep1} className="space-y-3.5">
            {/* Mobile Phone */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 ml-0.5">
                  Mobile Phone Number <span className="text-danger-ink">*</span>
                </label>
                {phone && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors duration-100 ${
                      phoneValidation.isValid
                        ? 'bg-surface-muted text-ink border border-line'
                        : phoneValidation.status === 'invalid_prefix'
                        ? 'bg-danger-subtle text-danger-ink border border-danger/20'
                        : 'bg-warning-subtle text-warning-ink border border-warning/20'
                    }`}
                  >
                    {phoneValidation.isValid ? (phoneValidation.carrier || 'Valid PH Mobile') : phoneValidation.message}
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 text-xs font-bold font-mono">
                  +63
                </div>
                <input
                  type="tel"
                  maxLength={12}
                  value={phone}
                  onChange={(e) => setPhone(formatPhPhone(e.target.value))}
                  className={`w-full h-9 pl-12 pr-3 bg-white border rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none transition-colors duration-100 shadow-2xs font-mono ${
                    phone && phoneValidation.isValid
                      ? 'border-line focus:border-line'
                      : phone && !phoneValidation.isValid
                      ? 'border-warning/40 focus:border-warning'
                      : 'border-slate-300 focus:border-slate-500'
                  }`}
                  placeholder="917 123 4567"
                  required
                />
              </div>
            </div>

            {/* Date of Birth & Sex Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 ml-0.5">
                    Date of Birth <span className="text-danger-ink">*</span>
                  </label>
                  {calculatedAge !== null && (
                    <span className="text-[10px] font-mono font-bold text-slate-500">
                      Age: {calculatedAge}
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  max={maxBirthDate}
                  min={minBirthDate}
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">
                  Sex <span className="text-danger-ink">*</span>
                </label>
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs cursor-pointer"
                  required
                >
                  {SEX_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={!isStep1Valid}
              className="w-full h-10 mt-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs cursor-pointer"
            >
              Continue to Residential Address
              <i className="ti ti-arrow-right text-xs" />
            </button>
          </form>
        )}

        {/* STEP 2: Residential Address (Philippine PSGC Cascading Selector) */}
        {step === 2 && (
          <form onSubmit={handleNextStep2} className="space-y-3.5">
            <PhilippineAddressSelector
              value={address}
              onChange={(nextAddress) => setAddress(nextAddress)}
              required
              idPrefix="onboarding_address"
            />

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-1/3 h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
              >
                <i className="ti ti-arrow-left text-xs" />
                Back
              </button>
              <button
                type="submit"
                disabled={!isStep2Valid}
                className="w-2/3 h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs cursor-pointer"
              >
                <span>Continue to Emergency Contact</span>
                <i className="ti ti-arrow-right text-xs" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: Emergency Contact */}
        {step === 3 && (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="p-3 bg-slate-50 rounded-md border border-slate-200/80 text-xs text-slate-600 flex items-start gap-2.5">
              <i className="ti ti-shield-check text-base text-slate-700 shrink-0 mt-0.5" />
              <span>
                Under DOLE Occupational Safety and Health (OSH) standards, every employee must designate an immediate contact for plant or workplace notifications.
              </span>
            </div>

            {/* Emergency Contact Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">
                Contact Full Name <span className="text-danger-ink">*</span>
              </label>
              <div className="relative">
                <i className="ti ti-user absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                <input
                  type="text"
                  maxLength={MAX_EMERGENCY_CONTACT_NAME_LENGTH}
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(sanitizePersonnelText(e.target.value))}
                  className="w-full h-9 pl-9 pr-3 bg-white border border-slate-300 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs"
                  placeholder="e.g. Maria Santos"
                  required
                />
              </div>
            </div>

            {/* Relationship & Phone Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">
                  Relationship <span className="text-danger-ink">*</span>
                </label>
                <select
                  value={emergencyRelationship}
                  onChange={(e) => setEmergencyRelationship(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs cursor-pointer"
                  required
                >
                  {RELATIONSHIP_OPTIONS.map((rel) => (
                    <option key={rel} value={rel}>
                      {rel}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 ml-0.5">
                    Contact Phone <span className="text-danger-ink">*</span>
                  </label>
                  {emergencyPhone && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors duration-100 ${
                        emergencyPhoneValidation.isValid
                          ? 'bg-surface-muted text-ink border border-line'
                          : emergencyPhoneValidation.status === 'invalid_prefix'
                          ? 'bg-danger-subtle text-danger-ink border border-danger/20'
                          : 'bg-warning-subtle text-warning-ink border border-warning/20'
                      }`}
                    >
                      {emergencyPhoneValidation.isValid ? (emergencyPhoneValidation.carrier || 'Valid PH Mobile') : emergencyPhoneValidation.message}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 text-xs font-bold font-mono">
                    +63
                  </div>
                  <input
                    type="tel"
                    maxLength={12}
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(formatPhPhone(e.target.value))}
                    className={`w-full h-9 pl-12 pr-3 bg-white border rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none transition-colors duration-100 shadow-2xs font-mono ${
                      emergencyPhone && emergencyPhoneValidation.isValid
                        ? 'border-line focus:border-line'
                        : emergencyPhone && !emergencyPhoneValidation.isValid
                        ? 'border-warning/40 focus:border-warning'
                        : 'border-slate-300 focus:border-slate-500'
                    }`}
                    placeholder="917 123 4567"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isSubmitting}
                className="w-1/3 h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
              >
                <i className="ti ti-arrow-left text-xs" />
                Back
              </button>
              <button
                type="submit"
                disabled={!isStep3Valid || isSubmitting}
                className="w-2/3 h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Activating Profile...</span>
                  </>
                ) : (
                  <>
                    <span>Complete Onboarding</span>
                    <i className="ti ti-check text-xs" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Footer with Logout */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex justify-center">
          <button
            onClick={handleLogout}
            className="text-slate-500 hover:text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors duration-100 cursor-pointer"
          >
            <i className="ti ti-logout text-sm" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
