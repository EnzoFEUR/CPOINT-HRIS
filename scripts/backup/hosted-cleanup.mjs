import { rm } from 'node:fs/promises';
import path from 'node:path';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||!path.isAbsolute(process.env.RUNNER_TEMP||''))throw new Error('Cleanup requires a GitHub-hosted runner.');
const root=path.resolve(process.env.RUNNER_TEMP);
for(const name of ['cpoint-backup-state','cpoint-backup-repository']) {
    const target=path.resolve(root,name);
    if(path.dirname(target)!==root)throw new Error('Unsafe cleanup target.');
    await rm(target,{recursive:true,force:true});
}
