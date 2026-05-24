
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
  'User-Agent': 'CaptureScript/1.0'
};

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
  console.log('Capture script started');
  
  try {
    // 1. خواندن فایل‌های درخواست
    const files = await ghGet('');
    const reqFiles = files.filter(f => f.name.startsWith('req_') && f.name.endsWith('.json'));
    
    if (reqFiles.length === 0) {
      console.log('No capture requests found');
      process.exit(0);
    }
    
    // 2. پردازش اولین درخواست
    const reqFile = reqFiles[0];
    const uuid = reqFile.name.replace('req_', '').replace('.json', '');
    
    try {
      const reqContent = await ghGet(reqFile.name);
      const reqData = JSON.parse(Buffer.from(reqContent.content, 'base64').toString());
      console.log('Processing:', reqData.url);
      
      // 3. حذف PDF قدیمی اگر وجود دارد
      try {
        const oldPdf = await ghGet('website/output.pdf');
        await ghDelete('website/output.pdf', oldPdf.sha, 'Remove old PDF');
        console.log('Old PDF deleted');
      } catch(e) {
        console.log('No old PDF to delete');
      }
      
      // 4. ایجاد PDF جدید
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.goto(reqData.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.pdf({ path: '/tmp/output.pdf', format: 'A4', printBackground: true });
      await page.close();
      await browser.close();
      
      // 5. آپلود PDF جدید
      const pdfContent = fs.readFileSync('/tmp/output.pdf');
      await ghPut('website/output.pdf', pdfContent, 'Capture ' + reqData.url);
      console.log('PDF uploaded successfully');
      
      // 6. حذف فایل درخواست
      await ghDelete(reqFile.name, reqFile.sha, 'Processed ' + uuid);
      console.log('Request file deleted');
      
      // 7. حذف سایر فایل‌های درخواست قدیمی
      for (const oldReq of reqFiles.slice(1)) {
        try {
          await ghDelete(oldReq.name, oldReq.sha, 'Remove old request');
        } catch(e) {
          console.error('Failed to delete old request:', e);
        }
      }
      
      console.log('Capture completed successfully');
    } catch(e) {
      console.error('Capture error:', e.message);
      try {
        await ghDelete(reqFile.name, reqFile.sha, 'Error processing');
      } catch(_) {}
      process.exit(1);
    }
    
  } catch(e) {
    console.error('Script error:', e.message);
    process.exit(1);
  }
})();
