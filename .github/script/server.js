
const fs = require('fs');
const { chromium } = require('playwright');
const fetch = require('node-fetch');

const REPO = process.env.REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.BRANCH || 'main';
const API_BASE = 'https://api.github.com/repos/' + REPO + '/contents/';
const HEADERS = {
  'Authorization': 'token ' + TOKEN,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'CaptureServer/1.0'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ghGet(path) {
  const r = await fetch(API_BASE + path, { headers: HEADERS });
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message);
  return r.json();
}

async function ghPut(path, content, msg, sha) {
  const body = { message: msg, content: Buffer.from(content).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(API_BASE + path, { method:'PUT', headers:{...HEADERS,'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message);
  return r.json();
}

async function ghDelete(path, sha, msg) {
  const r = await fetch(API_BASE + path, { method:'DELETE', headers:{...HEADERS,'Content-Type':'application/json'}, body: JSON.stringify({message:msg, sha, branch:BRANCH}) });
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  console.log('Capture server started');
  while (true) {
    try {
      const files = await ghGet('');
      const reqFiles = files.filter(f => f.name.startsWith('req_') && f.name.endsWith('.json'));
      for (const reqFile of reqFiles) {
        const uuid = reqFile.name.replace('req_', '').replace('.json', '');
        try {
          const reqContent = await ghGet(reqFile.name);
          const reqData = JSON.parse(Buffer.from(reqContent.content, 'base64').toString());
          console.log('Processing:', reqData.url);
          const page = await browser.newPage();
          await page.goto(reqData.url, { waitUntil: 'networkidle', timeout: 30000 });
          await page.pdf({ path: '/tmp/output.pdf', format: 'A4', printBackground: true });
          await page.close();

          const pdfContent = fs.readFileSync('/tmp/output.pdf');
          let pdfSha = null;
          try { const ex = await ghGet('website/output.pdf'); pdfSha = ex.sha; } catch(e) {}
          await ghPut('website/output.pdf', pdfContent, 'Capture ' + reqData.url, pdfSha);

          await ghDelete(reqFile.name, reqFile.sha, 'Processed ' + uuid);
          console.log('Done:', reqData.url);
        } catch(e) {
          console.error('Error:', e.message);
          try { await ghDelete(reqFile.name, reqFile.sha, 'Error'); } catch(_) {}
        }
      }
    } catch(e) {
      console.error('Loop error:', e.message);
    }
    await sleep(5000);
  }
})();
