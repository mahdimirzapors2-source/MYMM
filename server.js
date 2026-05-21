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
  'User-Agent': 'VPN-Server/2.0'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message);
  return res.json();
}

async function apiPut(path, content, message, sha = null) {
  const body = { message, content: Buffer.from(content).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message);
  return res.json();
}

async function apiDelete(path, sha, message) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'DELETE', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha, branch: BRANCH })
  });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message);
}

async function fetchUrl(targetUrl, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
      timeout: 20000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = url.resolve(targetUrl, res.headers.location);
        fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: 'done',
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

async function processRequest(reqFile, uuid) {
  const reqFileData = await apiGet(`req_${uuid}.json`);
  const decoded = Buffer.from(reqFileData.content, 'base64').toString('utf-8');
  const reqData = JSON.parse(decoded);
  const response = await fetchUrl(reqData.url);
  const resContent = JSON.stringify({ ...response, timestamp: Date.now() });
  await apiPut(`res_${uuid}.json`, resContent, `Response`);
  await apiDelete(`req_${uuid}.json`, reqFileData.sha, `Processed`);
}

(async () => {
  console.log('VPN Server (full assets) running');
  while (true) {
    try {
      const files = await apiGet('');
      if (!Array.isArray(files)) { await sleep(5000); continue; }
      const reqFiles = files.filter(f => f.name.startsWith('req_') && f.name.endsWith('.json'));
      for (const reqFile of reqFiles) {
        const uuid = reqFile.name.replace('req_', '').replace('.json', '');
        try {
          await processRequest(reqFile, uuid);
        } catch (e) {
          try {
            const errContent = JSON.stringify({ status: 'error', error: e.message, timestamp: Date.now() });
            await apiPut(`res_${uuid}.json`, errContent, `Error`);
            await apiDelete(`req_${uuid}.json`, reqFile.sha, `Error`);
          } catch (e2) {}
        }
      }
      // پاکسازی قدیمی
      const now = Date.now();
      const resFiles = files.filter(f => f.name.startsWith('res_') && f.name.endsWith('.json'));
      for (const rf of resFiles) {
        try {
          const data = await apiGet(rf.name);
          const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
          if (parsed.timestamp && now - parsed.timestamp > 300000) {
            await apiDelete(rf.name, data.sha, 'Cleanup old res');
          }
        } catch (e) {}
      }
      await sleep(3000);
    } catch (e) {}
  }
})();
