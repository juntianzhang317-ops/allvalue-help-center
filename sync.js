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
  SPACE_ID: process.env.FEISHU_SPACE_ID || '7582861710898236640',
  ROOT_TOKEN: process.env.FEISHU_ROOT_TOKEN || 'VTc4wMaKSikU72k7YPScrZz8nYc',
  OUTPUT_DIR: path.join(__dirname, 'public'),
  SITE_NAME: 'AllValue 帮助中心',
};

let appAccessToken = '';

async function requestFeishu(method, apiPath, body = null) {
  const url = `https://open.feishu.cn/open-apis${apiPath}`;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'open.feishu.cn',
      path: apiPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appAccessToken}`,
      },
    };
    const req = https.request(options, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const r = JSON.parse(Buffer.concat(chunks).toString());
        if (r.code !== 0) reject(new Error(`Feishu ${r.code}: ${r.msg}`));
        else resolve(r.data);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAppAccessToken() {
  const r = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ app_id: CONFIG.APP_ID, app_secret: CONFIG.APP_SECRET });
    const req = https.request({
      hostname: 'open.feishu.cn',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
  if (r.code !== 0) throw new Error('获取token失败: ' + r.msg);
  appAccessToken = r.tenant_access_token;
  console.log('✅ 已获取飞书访问凭证');
}

async function getNodes(parentToken = '') {
  const path = `/wiki/v2/spaces/${CONFIG.SPACE_ID}/nodes${parentToken ? `?parent_node_token=${parentToken}` : ''}`;
  const d = await requestFeishu('GET', path);
  return d?.items || [];
}

async function getDocContent(objToken) {
  try {
    const blocks = await requestFeishu('GET', `/docx/v1/documents/${objToken}/blocks?page_size=500`);
    if (blocks?.items) return extractText(blocks.items);
  } catch (e) { /* ignore */ }
  return '';
}

function extractText(blocks) {
  const texts = [];
  function walk(b) {
    if ([2,3].includes(b.block_type)) {
      const t = b.text?.elements?.map(e => e.text_run?.content || '').join('') || '';
      if (t) texts.push(t);
    }
    if (b.children) b.children.forEach(id => { const c = blocks.find(x => x.block_id === id); if (c) walk(c); });
  }
  blocks.forEach(walk);
  return texts.join('\n\n');
}

function escapeHtml(t) {
  if (!t) return '';
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let searchIndex = [];
function addIdx(node) {
  if (node.obj_type === 'docx') searchIndex.push({ token: node.node_token, title: node.title });
  if (node.children) node.children.forEach(addIdx);
}

async function buildTree(parentToken = '') {
  const nodes = await getNodes(parentToken);
  const tree = [];
  for (const n of nodes) {
    if (n.node_token === CONFIG.ROOT_TOKEN && !parentToken) {
      const children = await buildTree(n.node_token);
      tree.push(...children);
      continue;
    }
    const tn = { node_token: n.node_token, title: n.title, obj_type: n.obj_type, obj_token: n.obj_token, url: n.url, children: [] };
    addIdx(tn);
