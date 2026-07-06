#!/usr/bin/env node
/**
 * AllValue 帮助中心 - 飞书知识库同步脚本
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
  APP_ID: process.env.FEISHU_APP_ID || '',
  APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  SPACE_ID: '7582861710898236640',
  ROOT_TOKEN: 'VTc4wMaKSikU72k7YPScrZz8nYc',
  OUTPUT_DIR: path.join(__dirname, 'public'),
  SITE_NAME: 'AllValue 帮助中心',
};

let appAccessToken = '';

function httpReq(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: 'open.feishu.cn', path: apiPath, method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appAccessToken}` } };
    const req = https.request(opts, res => { let c = []; res.on('data', x => c.push(x)); res.on('end', () => { const r = JSON.parse(Buffer.concat(c).toString()); if (r.code !== 0) reject(new Error(`${r.code}: ${r.msg}`)); else resolve(r.data); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getToken() {
  const r = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'open.feishu.cn', path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { let c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString()))); });
    req.on('error', reject);
    req.write(JSON.stringify({ app_id: CONFIG.APP_ID, app_secret: CONFIG.APP_SECRET }));
    req.end();
  });
  if (r.code !== 0) throw new Error(r.msg);
  appAccessToken = r.tenant_access_token;
  console.log('✅ 已获取飞书访问凭证');
}

async function getNodes(parent = '') {
  const p = `/wiki/v2/spaces/${CONFIG.SPACE_ID}/nodes${parent ? `?parent_node_token=${parent}` : ''}`;
  const d = await httpReq('GET', p);
  return d?.items || [];
}

async function getDoc(obj) {
  try {
    const b = await httpReq('GET', `/docx/v1/documents/${obj}/blocks?page_size=500`);
    if (b?.items) { const t = []; b.items.forEach(x => { if ([2,3].includes(x.block_type)) { const c = x.text?.elements?.map(e => e.text_run?.content || '').join('') || ''; if (c) t.push(c); } }); return t.join('\n\n'); }
  } catch(e) {}
  return '';
}

function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let idx = [];
function addIdx(n) { if (n.obj_type === 'docx') idx.push({ t: n.node_token, tt: n.title }); if (n.children) n.children.forEach(addIdx); }

async function tree(parent = '') {
  const ns = await getNodes(parent), res = [];
  for (const n of ns) {
    if (n.node_token === CONFIG.ROOT_TOKEN && !parent) { const ch = await tree(n.node_token); res.push(...ch); continue; }
    const tn = { node_token: n.node_token, title: n.title, obj_type: n.obj_type, obj_token: n.obj_token, url: n.url, children: [] };
    addIdx(tn);
    if (n.has_child) tn.children = await tree(n.node_token);
    res.push(tn); process.stdout.write('.');
  }
  return res;
}
