import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { executeBackupTask } from './worker.mjs';
import { cloudEnvironment, readCloudSettings, saveCloudStatus, publicCloudStatus } from './cloud.mjs';
import { nativeConnection } from './native.mjs';
import { inside, assertSeparated } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schedule = { enabled: true, hour: 2, minute: 17 };

export function hostedOperationId(runId, attempt) {
    const bytes = createHash('sha256').update(String(runId)+':'+String(attempt)).digest().subarray(0,16);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const s = bytes.toString('hex');
    return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

export async function runHostedJob({ client, execute = executeBackupTask, operationId, action = 'create' }) {
    if (!['create','check'].includes(action)) throw new Error('Invalid hosted action.');
    const workerId = randomUUID(), controller = new AbortController();
    let lastHeartbeat = Date.now(), pulse, result, cloudReport;
    const rpc = async (name,args) => {
        const { data,error } = await client.rpc(name,args);
        if(error) throw new Error('Hosted backup database command failed.');
        return data;
    };
    const heartbeat = async (ready = true) => {
        await rpc('hris_backup_heartbeat',{p_worker_id:workerId,p_ready:ready,p_latest:{executor:'github_actions'}});
        lastHeartbeat=Date.now();
    };
    await heartbeat();
    const timer = setInterval(() => {
        if(pulse)return;
        pulse=heartbeat().catch(()=>{ if(Date.now()-lastHeartbeat>60000)controller.abort(); }).finally(()=>{pulse=undefined;});
    },15000);
    let job, succeeded=false;
    try {
        job=await rpc('hris_backup_hosted_start',{p_worker_id:workerId,p_operation_id:operationId,p_action:action});
        if(job.status==='completed')return;
        if(job.status!=='running')throw new Error('Hosted backup job is not runnable.');
        result=await execute(action,{signal:controller.signal,onProgress:async row=>{
            if(row.stage==='cloud_status') { cloudReport={cloud:row.cloud,schedule:row.schedule}; return; }
            if(['preflight','database_export','storage_export','encrypting_snapshot','cloud_upload','cloud_check'].includes(row.stage)) {
                console.log(JSON.stringify({stage:row.stage}));
                await rpc('hris_backup_progress',{p_worker_id:workerId,p_job_id:operationId,p_stage:row.stage});
            }
        }});
        if(result.cloud)cloudReport={cloud:result.cloud,schedule:result.schedule||schedule};
        if(action==='create' && (cloudReport?.cloud.status!=='verified'||cloudReport.cloud.snapshot_id!==result.snapshot_id)) throw new Error('Hosted cloud backup failed; temporary local data is not a durable backup.');
        delete result.cloud; delete result.schedule;
        await rpc('hris_backup_finish',{p_worker_id:workerId,p_job_id:operationId,p_success:true,p_result:result});
        succeeded=true;
    } finally {
        controller.abort();
        clearInterval(timer); await pulse;
        if(job?.status==='running'&&!succeeded) {
            try { await rpc('hris_backup_finish',{p_worker_id:workerId,p_job_id:operationId,p_success:false,p_result:{error_code:'BACKUP_FAILED'}}); }
            catch { console.warn('Backup job needs reconciliation; no completion was claimed.'); }
        }
        try {
            if(cloudReport) await rpc('hris_backup_automation',{p_worker_id:workerId,p_cloud:publicCloudStatus(cloudReport.cloud),p_schedule:schedule});
        } finally { await heartbeat(false).catch(()=>{}); }
    }
}

async function tool(executable,args,env={}) {
    return new Promise((resolve,reject)=>{
        const child=spawn(executable,args,{shell:false,windowsHide:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
        let bytes=0; const timer=setTimeout(()=>child.kill(),120000);
        child.stdout.on('data',b=>{bytes+=b.length;if(bytes>1024*1024)child.kill();});child.stderr.resume();
        child.on('error',()=>{clearTimeout(timer);reject(new Error('Hosted backup tool could not start.'));});
        child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Hosted backup repository preparation failed.'));});
    });
}

export async function bootstrapHosted(env=process.env) {
    if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||!path.isAbsolute(env.RUNNER_TEMP||'')) throw new Error('Use an isolated GitHub-hosted runner.');
    for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_DB_URL','BACKUP_B2_KEY_ID','BACKUP_B2_APPLICATION_KEY','BACKUP_CLOUD_PASSWORD','BACKUP_CLOUD_REPOSITORY']) if(!env[key]?.trim())throw new Error('Hosted backup secrets are incomplete.');
    const sourceUrl=new URL(env.SUPABASE_URL);
    if(sourceUrl.protocol!=='https:'||!/^[a-z0-9]+\.supabase\.co$/.test(sourceUrl.hostname)||sourceUrl.username||sourceUrl.password||sourceUrl.port||sourceUrl.search||sourceUrl.hash)throw new Error('Invalid hosted Supabase source.');
    const state=path.join(env.RUNNER_TEMP,'cpoint-backup-state'),repository=path.join(env.RUNNER_TEMP,'cpoint-backup-repository');
    await assertSeparated(state,[root,repository]);
    await mkdir(state,{recursive:true,mode:0o700});
    const config={version:1,repository,passwordFile:path.join(state,'repository-password.txt'),resticBin:'restic',envFile:path.join(state,'worker.env'),databaseUrlFile:path.join(state,'database-url.txt'),
        cloud:{provider:'b2',repository:env.BACKUP_CLOUD_REPOSITORY.trim(),passwordFile:path.join(state,'cloud-password.txt'),credentialsFile:path.join(state,'cloud-credentials.env'),schedule}};
    const project=sourceUrl.hostname.split('.')[0];
    nativeConnection(env.SUPABASE_DB_URL,project,path.join(state,'postgres.pgpass'));
    const cloud=await readCloudSettings(config,state,root);
    const write=(name,value)=>writeFile(name,value,{mode:0o600,flag:'wx'});
    await write(config.passwordFile,randomBytes(48).toString('base64url')+'\n');
    await write(cloud.passwordFile,env.BACKUP_CLOUD_PASSWORD.trim()+'\n');
    await write(cloud.credentialsFile,`AWS_ACCESS_KEY_ID=${env.BACKUP_B2_KEY_ID.trim()}\nAWS_SECRET_ACCESS_KEY=${env.BACKUP_B2_APPLICATION_KEY.trim()}\n`);
    await write(config.databaseUrlFile,env.SUPABASE_DB_URL.trim()+'\n');
    await write(config.envFile,`SUPABASE_URL=${JSON.stringify(env.SUPABASE_URL.trim())}\nSUPABASE_SERVICE_ROLE_KEY=${JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY.trim())}\n`);
    await write(path.join(state,'config.json'),JSON.stringify(config));
    const client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}});
    const {data:previous,error}=await client.from('hris_backup_worker').select('cloud_status').eq('id',1).single();
    if(error)throw new Error('Hosted backup status could not be loaded.');
    if(previous?.cloud_status?.configured) await saveCloudStatus(state,cloud,previous.cloud_status);
    await tool('restic',['--repo',repository,'--password-file',config.passwordFile,'--no-cache','init','--from-repo',cloud.repository,'--from-password-file',cloud.passwordFile,'--copy-chunker-params'],await cloudEnvironment(cloud));
    process.env.HRIS_BACKUP_STATE_DIR=state;
    return {client,state,repository};
}

async function main() {
    let context;
    try {
        context=await bootstrapHosted();
        const operationId=hostedOperationId(process.env.GITHUB_RUN_ID,process.env.GITHUB_RUN_ATTEMPT);
        for(const key of ['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_DB_URL','BACKUP_B2_KEY_ID','BACKUP_B2_APPLICATION_KEY','BACKUP_CLOUD_PASSWORD']) delete process.env[key];
        await runHostedJob({client:context.client,operationId,action:process.env.BACKUP_ACTION||'create'});
        console.log('Hosted encrypted backup operation completed.');
    } catch(error) {
        const code=['PG_CLIENT_VERSION','BACKUP_TOOL_START','BACKUP_TOOL_FAILED','SOURCE_CONNECTION','DB_AUTH_FAILED','DB_TLS_FAILED','DB_PERMISSION_DENIED','DB_NETWORK_FAILED'].includes(error.code)?error.code:'BACKUP_FAILED';
        console.error(`Hosted backup failed (${code}). Existing recovery points are preserved; inspect the last safe progress stage and configured secrets.`);process.exitCode=1;
    }
    finally {
        if(context) {
            await context.client.removeAllChannels();
            for(const target of [context.state,context.repository]) {
                if(!inside(process.env.RUNNER_TEMP,target)||path.dirname(target)!==path.resolve(process.env.RUNNER_TEMP))throw new Error('Unsafe hosted cleanup path.');
                await rm(target,{recursive:true,force:true});
            }
        }
    }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
