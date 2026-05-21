const http = require('http');
const https = require('https');
const url = require('url');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const BASE = `https://api.github.com/repos/${REPO}/contents`;
const HEADERS = {
  'Authorization': `token ${TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'VPN-Server/1.0'
};

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function apiGet(path){
  const res = await fetch(`${BASE}/${path}`,{headers:HEADERS});
  if(!res.ok){ const err=await res.json().catch(()=>({})); throw new Error(err.message); }
  return res.json();
}

async function apiPut(path,content,message,sha=null){
  const body={message,content:Buffer.from(content).toString('base64'),branch:BRANCH};
  if(sha) body.sha=sha;
  const res=await fetch(`${BASE}/${path}`,{method:'PUT',headers:{...HEADERS,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){ const err=await res.json().catch(()=>({})); throw new Error(err.message); }
  return res.json();
}

async function apiDelete(path,sha,message){
  const res=await fetch(`${BASE}/${path}`,{method:'DELETE',headers:{...HEADERS,'Content-Type':'application/json'},body:JSON.stringify({message,sha,branch:BRANCH})});
  if(!res.ok){ const err=await res.json().catch(()=>({})); throw new Error(err.message); }
}

async function fetchUrl(targetUrl){
  const parsed=new url.URL(targetUrl);
  const mod=parsed.protocol==='https:'?https:http;
  return new Promise((resolve,reject)=>{
    const opts={
      hostname:parsed.hostname,port:parsed.port||(parsed.protocol==='https:'?443:80),
      path:parsed.pathname+parsed.search,method:'GET',
      headers:{'User-Agent':'Mozilla/5.0'},timeout:30000
    };
    const req=mod.request(opts,res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({body:Buffer.concat(chunks).toString('base64'),type:res.headers['content-type']||'text/plain',statusCode:res.statusCode}));
    });
    req.on('error',reject);
    req.on('timeout',()=>{req.destroy();reject(new Error('Timeout'));});
    req.end();
  });
}

async function loop(){
  console.log('VPN Server (UUID) running');
  while(true){
    try{
      const files=await apiGet('');
      if(!Array.isArray(files)){ await sleep(5000); continue; }
      const reqFiles=files.filter(f=>f.name.startsWith('req_')&&f.name.endsWith('.json'));
      for(const reqFile of reqFiles){
        const uuid=reqFile.name.replace('req_','').replace('.json','');
        try{
          const reqFileData=await apiGet(`req_${uuid}.json`);
          const decoded=Buffer.from(reqFileData.content,'base64').toString('utf-8');
          const reqData=JSON.parse(decoded);
          const response=await fetchUrl(reqData.url);
          const resContent=JSON.stringify({status:'done',body:response.body,type:response.type,statusCode:response.statusCode,timestamp:Date.now()});
          let resSha=null;
          try{ const ex=await apiGet(`res_${uuid}.json`); resSha=ex.sha; }catch(e){}
          await apiPut(`res_${uuid}.json`,resContent,`Response`,resSha);
          await apiDelete(`req_${uuid}.json`,reqFileData.sha,`Processed`);
        }catch(e){
          console.error('Error:',e.message);
          try{
            const errContent=JSON.stringify({status:'error',error:e.message,timestamp:Date.now()});
            let resSha=null;
            try{ const ex=await apiGet(`res_${uuid}.json`); resSha=ex.sha; }catch(e2){}
            await apiPut(`res_${uuid}.json`,errContent,`Error`,resSha);
            await apiDelete(`req_${uuid}.json`,reqFile.sha,`Error`);
          }catch(e2){}
        }
      }
      await sleep(3000);
    }catch(e){ console.error('Loop:',e.message); }
  }
}
loop().catch(e=>{console.error('Fatal:',e);process.exit(1);});
