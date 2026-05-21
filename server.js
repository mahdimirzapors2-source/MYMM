const fs=require('fs'),{execSync}=require('child_process'),http=require('http'),https=require('https'),url=require('url');
const reqFile='req.json',resFile='res.json';
const TOKEN=process.env.GITHUB_TOKEN;
const REPO=process.env.GITHUB_REPOSITORY;
const BRANCH=process.env.GITHUB_REF_NAME||'main';
const REMOTE=`https://x-access-token:${TOKEN}@github.com/${REPO}.git`;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function git(cmd){execSync(`git ${cmd}`,{stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});}

async function loop(){
  while(true){
    try{
      // دریافت آخرین تغییرات
      execSync('git pull ' + REMOTE + ' ' + BRANCH, {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
      
      let req=null;
      try{req=JSON.parse(fs.readFileSync(reqFile));}catch(e){}
      
      if(req && req.status==='pending'){
        console.log('Forwarding:', req.request.url);
        const parsed = url.parse(req.request.url);
        const p = parsed.protocol === 'https:' ? https : http;
        
        const response = await new Promise((resolve, reject) => {
          const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.path,
            method: req.request.method || 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0'
            }
          };
          
          const proxyReq = p.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
              resolve({
                body: Buffer.concat(chunks).toString('base64'),
                type: proxyRes.headers['content-type'] || 'text/plain'
              });
            });
          });
          
          proxyReq.on('error', reject);
          proxyReq.end();
        });
        
        fs.writeFileSync(resFile, JSON.stringify({
          status: 'done',
          body: response.body,
          type: response.type
        }));
        
        execSync('git add ' + resFile, {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
        execSync('git commit -m "response" --allow-empty', {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
        execSync('git push ' + REMOTE + ' HEAD:' + BRANCH, {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
        
        fs.writeFileSync(reqFile, JSON.stringify({status: 'waiting'}));
        execSync('git add ' + reqFile, {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
        execSync('git commit -m "reset request" --allow-empty', {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
        execSync('git push ' + REMOTE + ' HEAD:' + BRANCH, {stdio:'pipe',env:{...process.env,GIT_ASKPASS:'echo'}});
      }
    } catch(e) {
      console.log('Error in loop:', e.message);
    }
    await sleep(3000);
  }
}

loop().catch(e => console.log('Fatal error:', e));
console.log('VPN Server is running...');
