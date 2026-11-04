import {supabase} from '../supabaseClient.js';
import {readCachedSource,invalidateCache} from '../middleware/cacheMiddleware.js';
import {getWithholdingTableVersionError,getWithholdingTableError,normalizeWithholdingBrackets} from '../../shared/statutorySettings.mjs';

export const WITHHOLDING_COLUMNS = 'id,frequency,effective_from,brackets,created_by,created_at,updated_at';
const key='/api/payroll/withholding-tax-tables';
export const invalidateWithholdingTablesCache=()=>invalidateCache([key]);
export const withholdingUnavailable=()=>Object.assign(new Error('Withholding tax tables could not be verified. Refresh before calculating payroll.'),{status:503});

export function loadWithholdingTaxSetup(client=supabase) {
    return readCachedSource(key,async()=>{
        const {data,error}=await client.from('withholding_tax_tables').select(WITHHOLDING_COLUMNS)
            .order('effective_from',{ascending:false}).order('id').limit(1001).abortSignal(AbortSignal.timeout(5000));
        if (['42P01','PGRST205'].includes(error?.code)) return {versions:[],setup_required:true};
        if(error||!Array.isArray(data)||data.length>1000||data.some(row=>getWithholdingTableVersionError(row)))throw withholdingUnavailable();
        return {versions:data,setup_required:false};
    },15);
}
export async function loadWithholdingTaxVersions(client=supabase) {
    return (await loadWithholdingTaxSetup(client)).versions;
}
export function assertWithholdingTable(expected, actual) {
    if(expected===undefined)return;
    if(getWithholdingTableError(expected))throw Object.assign(new Error('Invalid withholding preview. Refresh before saving.'),{status:400});
    if(JSON.stringify(normalizeWithholdingBrackets(expected))!==JSON.stringify(normalizeWithholdingBrackets(actual)))
        throw Object.assign(new Error('Withholding tables changed. Refresh the payroll preview before saving.'),{status:409});
}
