import express from 'express';
import {supabase} from '../supabaseClient.js';
import {hasVerifiedManagerRole} from '../middleware/authMiddleware.js';
import {isCreditUuid} from '../../shared/leaveCredits.mjs';
import {getManilaWorkDate} from '../../shared/workPolicy.mjs';
import {DEFAULT_WITHHOLDING_TABLES} from '../../shared/payrollTax.mjs';
import {getWithholdingTableVersionError,normalizeWithholdingBrackets} from '../../shared/statutorySettings.mjs';
import {loadWithholdingTaxSetup,invalidateWithholdingTablesCache,WITHHOLDING_COLUMNS,withholdingUnavailable} from '../services/withholdingTaxService.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function createWithholdingTaxRouter({client=supabase,onChange=()=>{}}={}) {
    const router=express.Router();
    router.use((req,res,next)=>hasVerifiedManagerRole(req.user)?next():res.status(403).json({success:false,error:'Verified HR or administrator access is required.'}));
    const wrap=fn=>async(req,res)=>{
        try{res.set('Cache-Control','private, no-store');await fn(req,res);}
        catch(error){res.status(error.status||503).json({success:false,error:error.status?error.message:'Withholding settings are unavailable. Refresh before retrying.'});}
    };
    router.get('/',wrap(async(req,res)=>{
        res.json({...await loadWithholdingTaxSetup(client),today:getManilaWorkDate(),defaults:DEFAULT_WITHHOLDING_TABLES});
    }));
    const change=action=>wrap(async(req,res)=>{
        let existing;
        if(action!=='created'){
            if(!isCreditUuid(req.params.id))throw fail('Invalid table version ID.');
            const result=await client.from('withholding_tax_tables').select(WITHHOLDING_COLUMNS).eq('id',req.params.id).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
            if(result.error)throw withholdingUnavailable();
            existing=result.data;
            if(!existing)throw fail('Table version not found.',404);
            if(existing.effective_from<=getManilaWorkDate())throw fail('Effective versions cannot be changed. Add a new version.',409);
            if(req.body?.expected_updated_at!==existing.updated_at)throw fail('This version changed. Refresh before saving.',409);
        }
        let payload;
        if(action!=='deleted'){
            const draft={frequency:existing?.frequency||req.body?.frequency,effective_from:req.body?.effective_from,brackets:req.body?.brackets};
            const problem=getWithholdingTableVersionError(draft);
            if(problem)throw fail(problem);
            if(draft.effective_from<getManilaWorkDate())throw fail('The effective date cannot be in the past.');
            payload={...draft,brackets:normalizeWithholdingBrackets(draft.brackets)};
        }
        let query=client.from('withholding_tax_tables');
        if(action==='created')query=query.insert({...payload,created_by:req.user.id});
        else if(action==='updated')query=query.update({...payload,updated_at:new Date().toISOString()}).eq('id',existing.id).eq('updated_at',existing.updated_at);
        else query=query.delete().eq('id',existing.id).eq('updated_at',existing.updated_at);
        const {data,error}=await query.select(WITHHOLDING_COLUMNS).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
        if(error?.code==='23505')throw fail('A version already starts on that date. Refresh the table.',409);
        if(error?.message?.includes('WITHHOLDING_VERSION_LOCKED'))throw fail('This version is effective or has a posted payroll cutoff. Add a new version.',409);
        if(error)throw withholdingUnavailable();
        if(!data)throw fail('This version changed. Refresh before saving.',409);
        invalidateWithholdingTablesCache();
        onChange(req,action,{before:existing||null,after:action==='deleted'?null:data});
        res.status(action==='created'?201:200).json({success:true,data,message:'Withholding tax table saved.'});
    });
    router.post('/',change('created'));router.put('/:id',change('updated'));router.delete('/:id',change('deleted'));
    return router;
}
