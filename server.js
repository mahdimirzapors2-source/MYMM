const { execSync } = require('child_process');
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiGet(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.message || `GET ${path}: HTTP ${res.status}`); }
  return res.json();
}

async function apiPut(path, content, message, sha = null) {
  const body = { message, content: Buffer.from(content).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.message || `PUT ${path}: HTTP ${res.status}`); }
  return res.json();
}

async function apiDelete(path, sha, message) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'DELETE', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha, branch: BRANCH })
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.message || `DELETE ${path}: HTTP ${res.status}`); }
}

async function fetchUrl(targetUrl) {
  const parsed = new url.URL(targetUrl);
  const mod = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: parsed.hostname, port: parsed.port || (parsed.protocol==='https:'?443:80),
      path: parsed.pathname + parsed.search, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5'
      }, timeout: 30000
    };
    const req = mod.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('base64'),
        type: res.headers['content-type'] || 'text/plain',
        statusCode: res.statusCode
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function loop() {
  console.log('VPN Server started (UUID version)');
  while(true) {
    try {
      const files = await apiGet('');
      if (!Array.isArray(files)) { await sleep(5000); continue; }
      const reqFiles = files.filter(f => f.name.startsWith('req_') && f.name.endsWith('.json'));
      for (const reqFile of reqFiles) {
        const uuid = reqFile.name.replace('req_', '').replace('.json', '');
        try {
          const reqFileData = await apiGet(`req_${uuid}.json`);
          const decoded = Buffer.from(reqFileData.content, 'base64').toString('utf-8');
          const reqData = JSON.parse(decoded);
          console.log(`Processing ${uuid.slice(0,8)}: ${reqData.url}`);
          const response = await fetchUrl(reqData.url);
          const resContent = JSON.stringify({ status:'done', body: response.body, type: response.type, statusCode: response.statusCode, timestamp: Date.now() });
          let resSha = null;
          try { const existing = await apiGet(`res_${uuid}.json`); resSha = existing.sha; } catch(e){}
          await apiPut(`res_${uuid}.json`, resContent, `Response for ${uuid}`, resSha);
          await apiDelete(`req_${uuid}.json`, reqFileData.sha, `Processed ${uuid}`);
        } catch(e) {
          console.error(`Error processing ${uuid.slice(0,8)}:`, e.message);
          try {
            const errContent = JSON.stringify({ status:'error', error: e.message, timestamp: Date.now() });
            let resSha = null;
            try { const existing = await apiGet(`res_${uuid}.json`); resSha = existing.sha; } catch(e2){}
            await apiPut(`res_${uuid}.json`, errContent, `Error for ${uuid}`, resSha);
            await apiDelete(`req_${uuid}.json`, reqFile.sha, `Error ${uuid}`);
          } catch(e2){}
        }
      }
      const now = Date.now();
      const resFiles = files.filter(f => f.name.startsWith('res_') && f.name.endsWith('.json'));
      for (const resFile of resFiles) {
        try {
          const resData = await apiGet(resFile.name);
          const decoded = Buffer.from(resData.content, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          if (parsed.timestamp && (now - parsed.timestamp) > 600000) {
            await apiDelete(resFile.name, resData.sha, 'Cleanup old response');
          }
        } catch(e){}
      }
    } catch(e) { console.error('Loop error:', e.message); }
    await sleep(3000);
  }
}
loop().catch(e => { console.error('Fatal error:', e); process.exit(1); });
