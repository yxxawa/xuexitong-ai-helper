const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS,storage,plain}=require('./helpers/runtime.cjs');
function setup(t,respond,options={}){
 const env=domRuntime('', 'https://mooc1.chaoxing.com/');t.after(()=>env.window.close());const clock=options.clock||new Clock(),mem=options.mem||storage(),calls=[];
 const globals={...env.globals,...clock.globals(),...mem.globals,GM_info:{script:{version:options.version||'1.0.11'}}};
 const api=loadTS('packages/scripts/src/utils/update-check.ts',globals,{'@xuexitong-ai-helper/core/src/core/utils/request':{request:async(url,opts)=>{calls.push({url,opts:plain(opts)});return respond(url,calls.length);}}});
 const {createVersionLink}=loadTS('packages/scripts/src/elements/version.link.ts',globals,{'../utils/update-check':api});
 return {...env,clock,mem,api,calls,createVersionLink};
}
test('version metadata accepts normal manifests and published stable GitHub tags, and rejects prereleases or junk',t=>{
 const e=setup(t,()=>({version:'1.0.11'}));
 assert.equal(e.api.releaseVersion({version:'1.0.12'}),'1.0.12');assert.equal(e.api.releaseVersion({tag_name:'v1.1.0',draft:false,prerelease:false}),'1.1.0');
 for(const value of [null,'1.2.0',{}, {version:'latest'}, {version:'1.0.12-beta.1'}, {tag_name:'v1.0.12',draft:true}, {version:'1.0.12',prerelease:true}]) assert.equal(e.api.releaseVersion(value),undefined);
});
test('stale CDN metadata cannot hide a newer published version from another available source',async t=>{
 const e=setup(t,url=>url.includes('api.github.com')?{tag_name:'v1.0.12',html_url:'https://untrusted.test/'}:{version:'1.0.11'});
 assert.equal(await e.api.checkLatestVersion(),'1.0.12');assert.equal(e.calls.length,3);
 for(const call of e.calls){assert.equal(call.opts.type,'GM_xmlhttpRequest');assert.equal(call.opts.method,'get');assert.equal(call.opts.responseType,'json');assert.equal(call.opts.timeout,5000);assert.equal(call.opts.headers,undefined);}
});
test('one reachable CDN is sufficient when raw GitHub and the release API are unavailable',async t=>{
 const e=setup(t,url=>{if(!url.includes('cdn.jsdelivr.net'))throw new Error('offline');return {version:'1.0.12'};});
 assert.equal(await e.api.checkLatestVersion(),'1.0.12');assert.equal(e.calls.length,3);
});
test('semantic version comparison handles numeric ordering and never displays a downgrade',t=>{
 const e=setup(t,()=>({version:'1.0.11'}));
 assert.equal(e.api.versionLinkText('1.0.9','1.0.10'),'v1.0.9 → v1.0.10');
 assert.equal(e.api.versionLinkText('1.0.11','1.0.10'),'v1.0.11');assert.equal(e.api.versionLinkText('1.0.11','1.0.11'),'v1.0.11');
});
test('concurrent home renders share one check and persisted successful results are cached for thirty minutes',async t=>{
 const mem=storage(),clock=new Clock();let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const e=setup(t,async()=>{await gate;return {version:'1.0.12'};},{mem,clock});
 const first=e.api.checkLatestVersion(),second=e.api.checkLatestVersion();await clock.flush();assert.equal(e.calls.length,3);
 release();assert.equal(await first,'1.0.12');assert.equal(await second,'1.0.12');
 const reloaded=setup(t,()=>{assert.fail('No repeat network check');},{mem,clock});assert.equal(await reloaded.api.checkLatestVersion(),'1.0.12');
 await clock.advance(30*60*1000);await e.api.checkLatestVersion();assert.equal(e.calls.length,6);assert.equal(clock.timers.size,0);
});
test('all network failures remain silent and are cached briefly to avoid repeated requests',async t=>{
 const e=setup(t,()=>{throw new Error('blocked');});
 assert.equal(await e.api.checkLatestVersion(),undefined);assert.equal(e.calls.length,3);
 await e.api.checkLatestVersion();assert.equal(e.calls.length,3);await e.clock.advance(5*60*1000);await e.api.checkLatestVersion();assert.equal(e.calls.length,6);
});
test('a temporarily stale source never downgrades previously confirmed release metadata',async t=>{
 let version='1.0.12';const e=setup(t,()=>({version}));
 await e.api.checkLatestVersion();version='1.0.11';await e.clock.advance(30*60*1000);assert.equal(await e.api.checkLatestVersion(),'1.0.12');
});
test('the installed version is visible immediately and the home link always targets this repository latest release',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const e=setup(t,async()=>{await gate;return {version:'1.0.12',releaseUrl:'https://untrusted.test/'};});
 const link=e.createVersionLink();e.document.body.append(link);
 assert.equal(link.textContent,'v1.0.11');assert.equal(link.href,'https://github.com/yxxawa/xuexitong-ai-helper/releases/latest');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
 release();await e.clock.flush();assert.equal(link.textContent,'v1.0.11 → v1.0.12');assert.ok(link.classList.contains('has-update'));
});
test('failed update checks preserve the normal current-version link without an error dialog',async t=>{
 const e=setup(t,()=>{throw new Error('network');});const link=e.createVersionLink();e.document.body.append(link);await e.clock.flush();
 assert.equal(link.textContent,'v1.0.11');assert.ok(!link.classList.contains('has-update'));assert.equal(link.title,'打开最新 Release');
});
test('a removed home link is not changed by an older background response',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const e=setup(t,async()=>{await gate;return {version:'1.0.12'};});
 const link=e.createVersionLink();e.document.body.append(link);link.remove();release();await e.clock.flush();assert.equal(link.textContent,'v1.0.11');
});