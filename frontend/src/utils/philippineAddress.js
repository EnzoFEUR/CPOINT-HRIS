import psgc from '@dropdowns/psgc';

// In-memory index caches for instant sub-millisecond filtering
let barangayIndexCache = null;
let provinceListCache = null;
let ncrMunicipalitiesCache = null;

const NCR_DISTRICT_CODES = ['133900000', '137400000', '137500000', '137600000'];
const NCR_REGION_CODE = '130000000';

function getBarangayIndex() {
  if (!barangayIndexCache) {
    barangayIndexCache = new Map();
  }
  return barangayIndexCache;
}

export function getAllProvinces() {
  if (!provinceListCache) {
    try {
      const rawProvinces = psgc.getAllProvinces() || [];
      const nonNcrProvinces = rawProvinces.filter(
        (p) => !NCR_DISTRICT_CODES.includes(p.prv_code)
      );
      const unifiedList = [
        ...nonNcrProvinces,
        {
          name: 'Metro Manila',
          prv_code: 'NCR',
          reg_code: NCR_REGION_CODE
        }
      ];
      unifiedList.sort((a, b) => a.name.localeCompare(b.name));
      provinceListCache = unifiedList;
    } catch (err) {
      console.error('Failed to load provinces:', err);
      provinceListCache = [];
    }
  }
  return provinceListCache;
}

export function getMunicipalitiesByProvince(prvCode) {
  if (!prvCode) return [];
  const codeStr = String(prvCode).trim();

  if (codeStr === 'NCR' || NCR_DISTRICT_CODES.includes(codeStr)) {
    if (!ncrMunicipalitiesCache) {
      try {
        const combined = [];
        for (const distCode of NCR_DISTRICT_CODES) {
          const list = psgc.getMunicipalitiesByProvince(distCode) || [];
          combined.push(...list);
        }
        combined.sort((a, b) => a.name.localeCompare(b.name));
        ncrMunicipalitiesCache = combined;
      } catch (err) {
        console.error('Failed to load NCR municipalities:', err);
        ncrMunicipalitiesCache = [];
      }
    }
    return ncrMunicipalitiesCache;
  }

  try {
    return psgc.getMunicipalitiesByProvince(codeStr) || [];
  } catch (err) {
    console.error('Failed to load municipalities:', err);
    return [];
  }
}

export function getBarangaysByMunicipality(munCode) {
  if (!munCode) return [];
  const cache = getBarangayIndex();
  const key = String(munCode);
  if (cache.has(key)) {
    return cache.get(key);
  }
  try {
    const list = psgc.getBarangaysByMunicipality(munCode) || [];
    cache.set(key, list);
    return list;
  } catch (err) {
    console.error('Failed to load barangays:', err);
    return [];
  }
}

export function getRegionByProvince(prvCode) {
  if (!prvCode) return null;
  const codeStr = String(prvCode).trim();
  if (codeStr === 'NCR' || NCR_DISTRICT_CODES.includes(codeStr)) {
    return { name: 'National Capital Region (NCR)', reg_code: NCR_REGION_CODE };
  }
  try {
    const list = psgc.getRegionByProvince(codeStr);
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  } catch (err) {
    console.error('Failed to resolve region:', err);
    return null;
  }
}

export function getAllRegions() {
  try {
    return psgc.getAllRegions() || [];
  } catch (err) {
    console.error('Failed to load regions:', err);
    return [];
  }
}

export function getProvincesByRegion(regCode) {
  if (!regCode) return [];
  try {
    return psgc.getProvincesByRegion(regCode) || [];
  } catch (err) {
    console.error('Failed to load provinces:', err);
    return [];
  }
}

/**
 * Enterprise Address Formatter
 * Produces clean, official Philippine Standard Address format:
 * [Unit/Bldg/Street], [Barangay], [City/Municipality], [Province / Metro Manila]
 * (Region is intentionally omitted to eliminate administrative clutter and match standard postal formatting)
 */
export function formatAddress({
  street = '',
  barangay = null,
  municipality = null,
  province = null
}) {
  const parts = [];

  const cleanStreet = (street || '').trim();
  if (cleanStreet) {
    parts.push(cleanStreet);
  }

  if (barangay && barangay.name) {
    const bgyName = barangay.name.trim();
    // Avoid double "Brgy. Barangay"
    const prefix = /^barangay\b|^brgy\.?\b/i.test(bgyName) ? '' : 'Brgy. ';
    parts.push(`${prefix}${bgyName}`);
  }

  if (municipality && municipality.name) {
    parts.push(municipality.name.trim());
  }

  if (province && province.name) {
    const prvName = province.name.trim();
    // In NCR, districts like "NCR, Second District" are administrative.
    // Display as Metro Manila for standard mailing and record address.
    if (/^ncr,/i.test(prvName) || prvName.toLowerCase() === 'metro manila') {
      parts.push('Metro Manila');
    } else {
      parts.push(prvName);
    }
  }

  return parts.join(', ');
}
