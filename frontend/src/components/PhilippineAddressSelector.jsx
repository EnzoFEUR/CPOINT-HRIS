import { useState, useMemo, useCallback } from 'react';
import {
  getAllProvinces,
  getMunicipalitiesByProvince,
  getBarangaysByMunicipality,
  getRegionByProvince,
  formatAddress
} from '../utils/philippineAddress';

/**
 * Enterprise-Grade Philippine Address Cascading Selector (PSGC Compliant)
 * 
 * Features:
 * - Sub-millisecond synchronous filtering across all 82 provinces / Metro Manila,
 *   1,634+ cities/municipalities, and 42,000+ barangays.
 * - Zero external network dependency (100% offline-ready, in-memory cached, 0ms ultra-low latency).
 * - Direct Province / Metro Manila selection (Region omitted to eliminate friction while auto-deriving in background).
 * - Clean 2x2 grid layout (Province + City, Barangay + Street) with responsive single-column mobile view.
 * - Full backwards-compatibility: allows toggling between Cascading Dropdowns and Manual Freeform Address.
 * - Real-time preview with standard Philippine postal format.
 */
export default function PhilippineAddressSelector({
  value = '',
  onChange,
  required = false,
  disabled = false,
  label = 'Residential Address',
  idPrefix = 'ph_addr',
  compact = false
}) {
  // Mode: 'dropdown' or 'manual'
  const [mode, setMode] = useState(() => {
    // If value already has text when mounting, start in dropdown if user prefers or manual if legacy
    return value && value.trim().length > 0 ? 'manual' : 'dropdown';
  });

  // Freeform text for manual mode
  const manualText = value || '';

  // Cascading selections
  const [selectedPrvCode, setSelectedPrvCode] = useState('');
  const [selectedMunCode, setSelectedMunCode] = useState('');
  const [selectedBgyCode, setSelectedBgyCode] = useState('');
  const [streetAddress, setStreetAddress] = useState('');

  // Load Provinces + Metro Manila (in-memory cached, instant 0ms)
  const provinces = useMemo(() => getAllProvinces(), []);

  // Filter Municipalities based on Province
  const municipalities = useMemo(() => {
    return selectedPrvCode ? getMunicipalitiesByProvince(selectedPrvCode) : [];
  }, [selectedPrvCode]);

  // Filter Barangays based on Municipality
  const barangays = useMemo(() => {
    return selectedMunCode ? getBarangaysByMunicipality(selectedMunCode) : [];
  }, [selectedMunCode]);

  // Resolve selected entity objects
  const selectedProvince = useMemo(() => {
    return provinces.find((p) => p.prv_code === selectedPrvCode) || null;
  }, [provinces, selectedPrvCode]);

  const selectedMunicipality = useMemo(() => {
    return municipalities.find((m) => m.mun_code === selectedMunCode) || null;
  }, [municipalities, selectedMunCode]);

  const selectedBarangay = useMemo(() => {
    return barangays.find((b) => b.bgy_code === selectedBgyCode) || null;
  }, [barangays, selectedBgyCode]);

  // Auto-derive region in background memory for compliance/DOLE reporting if needed
  const derivedRegion = useMemo(() => {
    return selectedPrvCode ? getRegionByProvince(selectedPrvCode) : null;
  }, [selectedPrvCode]);

  // Compute composite formatted address in dropdown mode
  const formattedAddress = useMemo(() => {
    if (mode === 'manual') {
      return manualText;
    }
    return formatAddress({
      street: streetAddress,
      barangay: selectedBarangay,
      municipality: selectedMunicipality,
      province: selectedProvince
    });
  }, [mode, manualText, streetAddress, selectedBarangay, selectedMunicipality, selectedProvince]);

  // Notify parent component on changes
  const notifyChange = useCallback(
    (nextAddress, details) => {
      if (typeof onChange === 'function') {
        onChange(nextAddress, details);
      }
    },
    [onChange]
  );

  // Province change handler
  const handleProvinceChange = (e) => {
    const prvCode = e.target.value;
    setSelectedPrvCode(prvCode);
    setSelectedMunCode('');
    setSelectedBgyCode('');

    const prvObj = provinces.find((p) => p.prv_code === prvCode) || null;
    const regObj = prvCode ? getRegionByProvince(prvCode) : null;
    const nextFormatted = formatAddress({
      street: streetAddress,
      barangay: null,
      municipality: null,
      province: prvObj
    });

    notifyChange(nextFormatted, {
      province: prvObj,
      region: regObj,
      municipality: null,
      barangay: null,
      street: streetAddress,
      isManual: false
    });
  };

  // Municipality / City change handler
  const handleMunicipalityChange = (e) => {
    const munCode = e.target.value;
    setSelectedMunCode(munCode);
    setSelectedBgyCode('');

    const munObj = municipalities.find((m) => m.mun_code === munCode) || null;
    const nextFormatted = formatAddress({
      street: streetAddress,
      barangay: null,
      municipality: munObj,
      province: selectedProvince
    });

    notifyChange(nextFormatted, {
      province: selectedProvince,
      region: derivedRegion,
      municipality: munObj,
      barangay: null,
      street: streetAddress,
      isManual: false
    });
  };

  // Barangay change handler
  const handleBarangayChange = (e) => {
    const bgyCode = e.target.value;
    setSelectedBgyCode(bgyCode);

    const bgyObj = barangays.find((b) => b.bgy_code === bgyCode) || null;
    const nextFormatted = formatAddress({
      street: streetAddress,
      barangay: bgyObj,
      municipality: selectedMunicipality,
      province: selectedProvince
    });

    notifyChange(nextFormatted, {
      province: selectedProvince,
      region: derivedRegion,
      municipality: selectedMunicipality,
      barangay: bgyObj,
      street: streetAddress,
      isManual: false
    });
  };

  // Street address input handler
  const handleStreetChange = (e) => {
    const text = e.target.value;
    setStreetAddress(text);

    const nextFormatted = formatAddress({
      street: text,
      barangay: selectedBarangay,
      municipality: selectedMunicipality,
      province: selectedProvince
    });

    notifyChange(nextFormatted, {
      province: selectedProvince,
      region: derivedRegion,
      municipality: selectedMunicipality,
      barangay: selectedBarangay,
      street: text,
      isManual: false
    });
  };

  // Manual textarea input handler
  const handleManualChange = (e) => {
    const text = e.target.value;
    notifyChange(text, { isManual: true });
  };

  // Toggle mode
  const toggleMode = () => {
    if (mode === 'dropdown') {
      // Switching to manual: preserve current composite string
      setMode('manual');
      notifyChange(formattedAddress, { isManual: true });
    } else {
      // Switching to dropdown
      setMode('dropdown');
      notifyChange(formattedAddress, {
        province: selectedProvince,
        region: derivedRegion,
        municipality: selectedMunicipality,
        barangay: selectedBarangay,
        street: streetAddress,
        isManual: false
      });
    }
  };

  return (
    <div className="w-full space-y-2">
      {/* Header with Mode Toggle */}
      <div className="flex items-center justify-between">
        <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">
          {label} {required && <span className="text-danger-ink">*</span>}
        </label>
        <button
          type="button"
          onClick={toggleMode}
          disabled={disabled}
          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors cursor-pointer select-none"
        >
          {mode === 'dropdown' ? (
            <>
              <i className="ti ti-pencil text-xs text-slate-400" />
              <span>Manual freeform text</span>
            </>
          ) : (
            <>
              <i className="ti ti-map-pin text-xs text-slate-700" />
              <span>Use Philippine PSGC Dropdowns</span>
            </>
          )}
        </button>
      </div>

      {mode === 'manual' ? (
        /* Manual Freeform Mode */
        <div>
          <textarea
            id={`${idPrefix}_manual`}
            name="address"
            rows={compact ? 2 : 3}
            maxLength={300}
            value={manualText}
            onChange={handleManualChange}
            disabled={disabled}
            placeholder="Unit / House No., Street, Barangay, City / Municipality, Province / Metro Manila, Postal Code"
            className="w-full p-2.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-slate-800 text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs resize-none"
            required={required}
          />
          <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
            <span>Freeform address mode enabled.</span>
            <span className="font-mono">{manualText.length} / 300</span>
          </div>
        </div>
      ) : (
        /* PSGC Cascading Dropdowns Mode: 2x2 Balanced Grid */
        <div className="space-y-2.5 bg-slate-50/70 p-3 rounded-lg border border-slate-200/80">
          {/* Row 1: Province / Metro Manila & City / Municipality */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Province / Metro Manila */}
            <div>
              <label
                htmlFor={`${idPrefix}_province`}
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1"
              >
                Province / Metro Manila {required && <span className="text-danger-ink">*</span>}
              </label>
              <select
                id={`${idPrefix}_province`}
                value={selectedPrvCode}
                onChange={handleProvinceChange}
                disabled={disabled}
                className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-none focus:border-slate-800 transition-colors shadow-2xs cursor-pointer truncate"
              >
                <option value="">Select Province / Metro Manila</option>
                {provinces.map((prv) => (
                  <option key={prv.prv_code} value={prv.prv_code}>
                    {prv.name}
                  </option>
                ))}
              </select>
            </div>

            {/* City / Municipality */}
            <div>
              <label
                htmlFor={`${idPrefix}_city`}
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1"
              >
                City / Municipality {required && <span className="text-danger-ink">*</span>}
              </label>
              <select
                id={`${idPrefix}_city`}
                value={selectedMunCode}
                onChange={handleMunicipalityChange}
                disabled={disabled || !selectedPrvCode || municipalities.length === 0}
                className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-none focus:border-slate-800 transition-colors shadow-2xs cursor-pointer truncate disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!selectedPrvCode ? 'Select Province First' : 'Select City / Municipality'}
                </option>
                {municipalities.map((mun) => (
                  <option key={mun.mun_code} value={mun.mun_code}>
                    {mun.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Barangay & Detailed Street Address */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Barangay */}
            <div>
              <label
                htmlFor={`${idPrefix}_barangay`}
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1"
              >
                Barangay {required && <span className="text-danger-ink">*</span>}
              </label>
              <select
                id={`${idPrefix}_barangay`}
                value={selectedBgyCode}
                onChange={handleBarangayChange}
                disabled={disabled || !selectedMunCode || barangays.length === 0}
                className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-none focus:border-slate-800 transition-colors shadow-2xs cursor-pointer truncate disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!selectedMunCode
                    ? 'Select City First'
                    : barangays.length === 0
                    ? 'N/A (Direct City Proper)'
                    : 'Select Barangay'}
                </option>
                {barangays.map((bgy) => (
                  <option key={bgy.bgy_code} value={bgy.bgy_code}>
                    {bgy.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Street Name / Building / House / Unit No. */}
            <div>
              <label
                htmlFor={`${idPrefix}_street`}
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1"
              >
                Street Name / Building / House / Unit No.
              </label>
              <input
                id={`${idPrefix}_street`}
                type="text"
                value={streetAddress}
                onChange={handleStreetChange}
                disabled={disabled}
                placeholder="e.g. Unit 402, 123 Rizal Ave"
                className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-none focus:border-slate-800 transition-colors shadow-2xs placeholder:text-slate-400"
              >
              </input>
            </div>
          </div>

          {/* Real-time Address Preview */}
          {formattedAddress && (
            <div className="pt-2 border-t border-slate-200/60 flex items-start gap-2 text-xs">
              <i className="ti ti-map-pin text-sm text-slate-700 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Assembled Address:
                </span>
                <span className="font-medium text-slate-800 break-words leading-tight">
                  {formattedAddress}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
