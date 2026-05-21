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
      let req=null;
      try{req=JSON.parse(fs.readFileSync(reqFile));}catch(e){}
      if(req&&req.status==='pending'){
        console.log('Forwarding:',req.request.url);
        const parsed=url.parse(req.request.url);
        const p=parsed.protocol==='https:'?https:http;
        const response=await new Promise(r=>{
          p.request({hostname:parsed.hostname,port:parsed.port||(parsed.protocol==='https:'?443:80),path:parsed.path,method:'GET'},res=>{
            const chunks=[];
            res.on('data',c=>chunks.push(c));
            res.on('end',()=>r({body:Buffer.concat(chunks).toString('base64'),type:res.headers['content-type']||'text/plain'}));
          }).end();
        });
        fs.writeFileSync(resFile,JSON.stringify({status:'done',body:response.body,type:response.type}));
        git('add '+resFile);
        git('commit -m res --allow-empty');
        git('push '+REMOTE+' HEAD:'+BRANCH);
        fs.writeFileSync(reqFile,JSON.stringify({status:'waiting'}));
        git('add '+reqFile);
        git('commit -m req --allow-empty');
        git('push '+REMOTE+' HEAD:'+BRANCH);
      }
    }catch(e){}
    await sleep(1000);
  }
}
loop();
