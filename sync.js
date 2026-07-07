#!/usr/bin/env node
/**
 * AllValue 帮助中心 - 完整版同步脚本
 * 支持：文字/标题/列表/表格/图片/代码块/提示块/白板/子页面/分隔线
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const CONFIG = {
  APP_ID: process.env.FEISHU_APP_ID || '',
  APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  SPACE_ID: process.env.FEISHU_SPACE_ID || '7582861710898236640',
  ROOT_TOKEN: process.env.FEISHU_ROOT_TOKEN || 'VTc4wMaKSikU72k7YPScrZz8nYc',
  OUTPUT_DIR: path.join(__dirname, 'public'),
  SITE_NAME: 'AllValue 帮助中心',
  FEISHU_WIKI_BASE: 'https://qima.feishu.cn/wiki',
  ASSETS_DIR: path.join(__dirname, 'public', 'assets'),
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_REPO: 'juntianzhang317-ops/allvalue-help-center',
};

let token = '';
let imgMap = {}; // 缓存：image_token -> local_url

// ============ HTTP 请求 ============
function req(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'open.feishu.cn', path: apiPath, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    };
    const r = https.request(opts, res => {
      let c = []; res.on('data', x => c.push(x));
      res.on('end', () => {
        const raw = Buffer.concat(c).toString();
        try { const d = JSON.parse(raw); if (d.code !== 0) reject(new Error(d.code + ': ' + d.msg)); else resolve(d.data); }
        catch(e) { reject(new Error('JSON解析失败: ' + raw.substring(0, 200))); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function getToken() {
  const raw = await new Promise((resolve, reject) => {
    const d = JSON.stringify({ app_id: CONFIG.APP_ID, app_secret: CONFIG.APP_SECRET });
    const r = https.request({
      hostname: 'open.feishu.cn',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => { let c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString()))); });
    r.on('error', reject); r.write(d); r.end();
  });
  if (raw.code !== 0) throw new Error('获取 token 失败: ' + raw.msg);
  token = raw.tenant_access_token;
}

// ============ 图片下载 ============
async function downloadImage(imgToken) {
  if (imgMap[imgToken]) return imgMap[imgToken];

  const imgDir = path.join(CONFIG.ASSETS_DIR, 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const filePath = path.join(imgDir, imgToken + '.png');

  // 直接用飞书 CDN URL（无需认证，可公开访问）
  // 飞书图片格式：https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/box/img_{token}/
  const cdnUrl = `https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/box/img_${imgToken}/?height=9999&width=9999&token=${imgToken}`;

  try {
    const file = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      https.get(cdnUrl, { headers: { 'Authorization': 'Bearer ' + token } }, res => {
        if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        } else {
          file.close();
          // 降级：直接用空占位
          fs.writeFileSync(filePath, '');
          resolve();
        }
      }).on('error', err => { fs.writeFileSync(filePath, ''); resolve(); });
    });

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
      imgMap[imgToken] = `/assets/images/${imgToken}.png`;
      return imgMap[imgToken];
    }
  } catch(e) {}

  imgMap[imgToken] = '';
  return '';
}

// ============ 白板下载 ============
async function downloadBoard(boardToken) {
  if (imgMap['board_' + boardToken]) return imgMap['board_' + boardToken];

  const boardDir = path.join(CONFIG.ASSETS_DIR, 'boards');
  if (!fs.existsSync(boardDir)) fs.mkdirSync(boardDir, { recursive: true });

  const filePath = path.join(boardDir, boardToken + '.svg');
  const previewUrl = `https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/box/board_${boardToken}/?height=800&width=1200&token=${boardToken}`;

  try {
    const file = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      https.get(previewUrl, { headers: { 'Authorization': 'Bearer ' + token } }, res => {
        if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        } else {
          file.close();
          fs.writeFileSync(filePath, '');
          resolve();
        }
      }).on('error', err => { fs.writeFileSync(filePath, ''); resolve(); });
    });

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
      imgMap['board_' + boardToken] = `/assets/boards/${boardToken}.svg`;
      return imgMap['board_' + boardToken];
    }
  } catch(e) {}

  imgMap['board_' + boardToken] = '';
  return '';
}

// ============ 文字元素渲染 ============
function renderElements(elements) {
  if (!elements || !elements.length) return '';
  let html = '';
  for (const el of elements) {
    const tr = el.text_run || {};
    let content = tr.content || '';
    if (!content) continue;

    // 转义 HTML
    content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const style = tr.text_element_style || {};
    let tag = 'span';
    let attrs = '';

    if (style.bold) tag = 'strong';
    if (style.italic && style.bold) { tag = 'strong'; attrs = ' style="font-style:italic"'; }
    else if (style.italic) tag = 'em';
    if (style.strikethrough) tag = 'del';
    if (style.inline_code) { tag = 'code'; content = content; }
    if (style.underline) attrs += ' style="text-decoration:underline"';

    // 链接
    if (el.link) {
      tag = 'a';
      attrs = ` href="${(el.link.url || '#').replace(/"/g, '&quot;')}" target="_blank" rel="noopener"`;
    }

    html += `<${tag}${attrs}>${content}</${tag}>`;
  }
  return html;
}

// ============ Block 渲染 ============
function renderBlock(b, blocksMap, depth) {
  const children = (b.children || []).map(id => blocksMap[id]).filter(Boolean);

  switch (b.block_type) {
    case 1: // Page root - skip
      return '';

    case 2: { // Text paragraph
      const el = renderElements(b.text?.elements);
      return el ? `<p>${el}</p>` : '';
    }

    case 3: { // Heading 1
      const el = renderElements(b.heading1?.elements);
      return el ? `<h1>${el}</h1>` : '';
    }

    case 4: { // Heading 2
      const el = renderElements(b.heading2?.elements);
      return el ? `<h2>${el}</h2>` : '';
    }

    case 5: { // Heading 3
      const el = renderElements(b.heading3?.elements);
      return el ? `<h3>${el}</h3>` : '';
    }

    case 6: { // Heading 4
      const el = renderElements(b.heading4?.elements);
      return el ? `<h4>${el}</h4>` : '';
    }

    case 12: { // Bullet list
      const items = children.map(c => `<li>${renderBlock(c, blocksMap, depth)}</li>`).join('');
      return items ? `<ul>${items}</ul>` : '';
    }

    case 13: { // Ordered list
      const items = children.map(c => `<li>${renderBlock(c, blocksMap, depth)}</li>`).join('');
      return items ? `<ol>${items}</ol>` : '';
    }

    case 14: { // Code block
      const lang = b.code?.language || '';
      const code = b.code?.elements?.map(e => e.text_run?.content || '').join('') || '';
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code class="language-${lang}">${escaped}</code></pre>`;
    }

    case 19: { // Callout
      const emoji = b.callout?.emoji_id ? getEmojiChar(b.callout.emoji_id) : '💡';
      const bg = b.callout?.background_color;
      const bc = b.callout?.border_color;
      const content = children.map(c => renderBlock(c, blocksMap, depth)).join('');
      const bgColor = bg === 2 ? '#FFF7E6' : bg === 3 ? '#E6F7FF' : bg === 4 ? '#F0FFF0' : '#F8F8FF';
      return `<blockquote class="callout" style="border-left-color:${bc === 2 ? '#FF9500' : '#0066CC'};background:${bgColor}">${emoji} ${content}</blockquote>`;
    }

    case 22: // Divider
      return '<hr>';

    case 27: { // Image
      const imgToken = b.image?.token;
      if (!imgToken) return '';
      const localPath = imgMap[imgToken] || '';
      if (localPath) {
        return `<figure><img src="${localPath}" alt="图片" style="max-width:100%;height:auto;border-radius:8px"></figure>`;
      }
      // 图片未下载成功，显示占位符并引导到飞书原文档
      return `<figure class="image-placeholder" style="background:#f5f5f5;border:2px dashed #ccc;border-radius:8px;padding:32px;text-align:center;margin:20px 0"><p style="color:#999;margin:0">📷 图片（请前往飞书原文档查看）</p></figure>`;
    }

    case 31: // Table
    case 32: {
      // Table row or cell - handled by table parent
      return '';
    }

    case 34: // Quote container - handled by children
      return children.map(c => renderBlock(c, blocksMap, depth)).join('');

    case 43: { // Whiteboard/Board
      const boardToken = b.board?.token;
      if (!boardToken) return '';
      const localPath = imgMap['board_' + boardToken] || '';
      if (localPath && fs.existsSync(path.join(CONFIG.ASSETS_DIR, '..', localPath))) {
        return `<figure class="board"><img src="${localPath}" alt="白板截图" style="max-width:100%;border-radius:8px;border:1px solid #e5e5e5"></figure>`;
      }
      return `<div class="board-placeholder"><p>📋 白板内容（请前往飞书原文档查看）</p></div>`;
    }

    case 51: // Sub-page list - skip, handled separately
      return '';

    default:
      // 其他类型，尝试渲染文字
      if (b.text) return `<p>${renderElements(b.text?.elements)}</p>`;
      return '';
  }
}

function getEmojiChar(emojiId) {
  // 常见飞书 emoji ID -> Unicode emoji
  const map = {
    'dart': '🎯', 'star': '⭐', 'warning': '⚠️', 'bulb': '💡', 'fire': '🔥',
    'check': '✅', 'cross': '❌', 'heart': '❤️', 'thumbsup': '👍', 'info': 'ℹ️',
    'rocket': '🚀', 'book': '📖', 'link': '🔗', 'warning_sign': '⚠️',
    'heavy_check_mark': '✅', 'exclamation_mark': '❗', 'white_check_mark': '✅',
  };
  return map[emojiId] || '💡';
}

// ============ 表格渲染 ============
function renderTable(b, blocksMap) {
  // b is the table block (type 31), children are table rows
  const rows = (b.children || []).map(id => blocksMap[id]).filter(Boolean);
  if (!rows.length) return '';

  let thead = '';
  let tbody = '';
  let colCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = (row.children || []).map(cid => blocksMap[cid]).filter(Boolean);
    if (!cells.length) continue;
    if (i === 0) colCount = cells.length;

    const cellTag = i === 0 ? 'th' : 'td';
    const rowHtml = cells.map(c => {
      const cellContent = c.table_cell?.children?.map(cid => {
        const cc = blocksMap[cid];
        if (!cc) return '';
        // 支持单元格内的文字和列表
        if (cc.block_type === 2) return renderBlock(cc, blocksMap, 0);
        if (cc.block_type === 12) return renderBlock(cc, blocksMap, 0);
        if (cc.block_type === 13) return renderBlock(cc, blocksMap, 0);
        if (cc.text) return renderBlock(cc, blocksMap, 0);
        return '';
      }).join('') || '';

      const isHeader = i === 0;
      const style = isHeader ? ' style="background:#f0f0f0;font-weight:600"' : '';
      return `<${cellTag}${style}>${cellContent}</${cellTag}>`;
    }).join('');

    if (i === 0) thead = `<thead><tr>${rowHtml}</tr></thead>`;
    else tbody += `<tr>${rowHtml}</tr>`;
  }

  if (!tbody) return '';
  return `<div class="table-wrapper"><table style="width:100%;border-collapse:collapse;font-size:14px">${thead}<tbody>${tbody}</tbody></table></div>`;
}

// ============ 文档内容获取 ============
async function getDocContent(objToken) {
  try {
    const blocks = await req('GET', '/open-apis/docx/v1/documents/' + objToken + '/blocks?page_size=500');
    if (!blocks.items) return '';

    // 构建 block map
    const blocksMap = {};
    for (const b of blocks.items) blocksMap[b.block_id] = b;

    // 收集 sub_page_list tokens 和图片 tokens
    const subPageTokens = new Set();
    const imgTokens = new Set();

    function collectTokens(b) {
      if (b.block_type === 51 && b.sub_page_list?.wiki_token) subPageTokens.add(b.sub_page_list.wiki_token);
      if (b.block_type === 27 && b.image?.token) imgTokens.add(b.image.token);
      if (b.block_type === 43 && b.board?.token) imgTokens.add('board_' + b.board.token);
      if (b.children) b.children.forEach(id => { const c = blocksMap[id]; if (c) collectTokens(c); });
    }
    blocks.items.forEach(collectTokens);

    // 下载图片（批量）
    process.stdout.write('[图]');
    for (const t of imgTokens) {
      if (t.startsWith('board_')) {
        await downloadBoard(t.replace('board_', ''));
      } else {
        await downloadImage(t);
      }
    }

    // 渲染内容
    const parts = [];

    // 普通内容
    for (const b of blocks.items) {
      if (b.block_type === 1) continue; // 跳过 page 根节点
      if (b.block_type === 31) { // Table
        const t = renderTable(b, blocksMap);
        if (t) parts.push(t);
        continue;
      }
      if (b.block_type === 51) continue; // 跳过 sub_page_list
      if (b.block_type === 32) continue; // table cell 由 table 处理
      if (b.block_type === 34) continue; // quote container 由 children 处理

      const h = renderBlock(b, blocksMap, 0);
      if (h) parts.push(h);
    }

    // Sub-page 内容
    for (const wt of subPageTokens) {
      try {
        const wikiChildren = await req('GET', '/open-apis/wiki/v2/spaces/' + CONFIG.SPACE_ID + '/nodes?parent_node_token=' + wt);
        for (const child of (wikiChildren.items || [])) {
          const childContent = await getDocContent(child.obj_token);
          if (childContent) {
            parts.push(`<h2>${child.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>`);
            parts.push(childContent);
          }
        }
      } catch(e) {}
    }

    return parts.join('\n');
  } catch(e) { return ''; }
}

// ============ 导航生成 ============
function genNav(tree, depth) {
  depth = depth || 0;
  let h = '';
  for (const n of tree) {
    if (n.children && n.children.length && depth < 2) {
      h += `<li class="nav-group"><span class="nav-group-title">${esc(n.title)}<span class="nav-arrow">▸</span></span><ul class="nav-sub">${genNav(n.children, depth + 1)}</ul></li>\n`;
    } else {
      h += `<li class="nav-leaf"><a href="/docs/${n.node_token}.html">${esc(n.title)}</a></li>\n`;
    }
  }
  return h;
}

function esc(t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ============ HTML 模板 ============
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.8;background:#f5f5f5;color:#333}
a{color:#0066cc;text-decoration:none}
a:hover{text-decoration:underline}
.layout{display:flex;min-height:100vh}
.sidebar{width:280px;background:#fff;border-right:1px solid #e5e5e5;position:fixed;height:100vh;overflow-y:auto;z-index:100}
.sidebar-header{padding:24px 20px;background:linear-gradient(135deg,#667eea,#764ba2);position:sticky;top:0}
.sidebar-header h1{font-size:15px;color:#fff;font-weight:600}
.sidebar-header p{font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px}
.nav-list{list-style:none;padding:8px 0}
.nav-leaf a{display:block;padding:9px 20px;color:#444;font-size:14px;border-left:3px solid transparent}
.nav-leaf a:hover{background:#f0f7ff;color:#0066cc;border-left-color:#0066cc;text-decoration:none}
.nav-leaf.active a{background:#f0f7ff;color:#0066cc;border-left-color:#0066cc;font-weight:500}
.nav-group-title{display:flex;align-items:center;padding:9px 20px;font-size:13px;font-weight:600;color:#222;cursor:pointer;user-select:none;border-left:3px solid transparent}
.nav-group-title:hover{background:#f5f5f5}
.nav-arrow{margin-left:auto;font-size:10px;color:#999;transition:transform .2s}
.nav-group.open>.nav-group-title{color:#667eea;border-left-color:#667eea}
.nav-group.open>.nav-group-title .nav-arrow{transform:rotate(90deg)}
.nav-sub{display:none;padding-left:0}
.nav-group.open>.nav-sub{display:block}
.nav-sub a{padding-left:36px;font-size:13px}
.main{flex:1;margin-left:280px;padding:0;max-width:900px}
.doc-header{padding:32px 48px 24px;background:#fff;border-bottom:1px solid #e5e5e5}
.doc-header h1{font-size:28px;color:#222;border:none;padding:0;margin:0}
.doc-header .breadcrumb{font-size:13px;color:#999;margin-top:8px}
.doc-body{padding:40px 48px;background:#fff;min-height:calc(100vh - 200px)}
.doc-body h1,.doc-body h2,.doc-body h3,.doc-body h4{color:#222;margin-top:32px;margin-bottom:16px}
.doc-body h1{font-size:26px;border-bottom:2px solid #667eea;padding-bottom:12px;margin-top:0}
.doc-body h2{font-size:20px;border-bottom:1px solid #eee;padding-bottom:8px}
.doc-body h3{font-size:17px}
.doc-body p{margin-bottom:16px;color:#444;line-height:1.8}
.doc-body ul,.doc-body ol{margin:12px 0 16px;padding-left:24px}
.doc-body li{margin-bottom:6px}
.doc-body pre{background:#1e1e1e;color:#d4d4d4;padding:16px 20px;border-radius:8px;overflow-x:auto;margin:16px 0;font-size:13px;line-height:1.6}
.doc-body code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:13px;font-family:"SFMono-Regular",Consolas,monospace}
.doc-body pre code{background:none;padding:0;border-radius:0;font-size:13px}
.doc-body blockquote.callout{padding:16px 20px;border-radius:8px;border-left:4px solid;margin:20px 0;font-size:14px;line-height:1.7}
.doc-body hr{border:none;border-top:1px solid #e5e5e5;margin:32px 0}
.doc-body figure{margin:20px 0;text-align:center}
.doc-body figure img{max-width:100%;height:auto;border-radius:8px;border:1px solid #e5e5e5}
.doc-body .board-placeholder{background:#f8f8f8;border:2px dashed #ccc;border-radius:8px;padding:32px;text-align:center;color:#666;margin:20px 0}
.table-wrapper{overflow-x:auto;margin:16px 0}
.table-wrapper table{border:1px solid #e5e5e5;border-radius:8px;overflow:hidden}
.table-wrapper th,.table-wrapper td{padding:10px 14px;border-bottom:1px solid #e5e5e5;text-align:left;font-size:14px}
.table-wrapper th{background:#f8f8f8;font-weight:600}
.table-wrapper tr:last-child td{border-bottom:none}
.back-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#f5f5f5;border-radius:6px;color:#666;font-size:14px;margin-bottom:24px}
.back-btn:hover{background:#e8e8e8;color:#333;text-decoration:none}
.footer{padding:24px 48px;border-top:1px solid #e5e5e5;color:#999;font-size:13px;text-align:center;background:#fff}
@media(max-width:768px){
.mobile-toggle{display:block;position:fixed;top:16px;left:16px;z-index:200;background:#667eea;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:18px}
.sidebar{transform:translateX(-100%);transition:transform .3s}
.sidebar.open{transform:translateX(0)}
.main{margin-left:0;max-width:100%;padding:0 16px}
.doc-header,.doc-body{padding:20px 0}
}
`;

function docPage(nav, title, nodeToken, content, breadcrumb) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} - ${CONFIG.SITE_NAME}</title>
<style>${CSS}</style>
</head><body>
<button class="mobile-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">☰</button>
<div class="layout">
<aside class="sidebar">
<div class="sidebar-header"><h1>📖 ${CONFIG.SITE_NAME}</h1><p>飞书知识库</p></div>
<nav><ul class="nav-list">${nav}</ul></nav>
</aside>
<div class="main">
<div class="doc-header">
<a class="back-btn" href="/">← 返回目录</a>
<h1>${esc(title)}</h1>
${breadcrumb ? `<div class="breadcrumb">${breadcrumb}</div>` : ''}
</div>
<div class="doc-body">${content || '<p>（暂无内容）</p>'}</div>
<div class="footer">${CONFIG.SITE_NAME} · 最后更新: ${now}</div>
</div>
</div>
<script>
document.querySelectorAll('.nav-group-title').forEach(function(el){el.addEventListener('click',function(){this.parentElement.classList.toggle('open');});});
// 侧边栏当前文章高亮
var current=document.querySelector('.nav-leaf a[href="'+location.pathname+'"]');
if(current)current.parentElement.classList.add('active');
</script>
</body></html>`;
}

function indexPage(nav) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${CONFIG.SITE_NAME}</title>
<style>${CSS}
.hero{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:60px 40px;text-align:center;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
.hero h1{font-size:42px;font-weight:700;margin-bottom:16px}
.hero p{font-size:18px;opacity:0.9;max-width:500px;line-height:1.7}
.hero p sub{font-size:14px;opacity:0.7;display:block;margin-top:16px}
</style>
</head><body>
<button class="mobile-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">☰</button>
<div class="layout">
<aside class="sidebar">
<div class="sidebar-header"><h1>📖 ${CONFIG.SITE_NAME}</h1><p>飞书知识库</p></div>
<nav><ul class="nav-list">${nav}</ul></nav>
</aside>
<div class="main" style="margin-left:280px">
<div class="hero">
<h1>🎯 ${CONFIG.SITE_NAME}</h1>
<p>一站式社交电商 SaaS 平台操作指南<p>基于飞书知识库实时同步<sub>点击左侧目录开始浏览</sub></p>
</div>
<div class="footer" style="margin-left:0">${CONFIG.SITE_NAME} · 最后更新: ${now}</div>
</div>
</div>
<script>document.querySelectorAll('.nav-group-title').forEach(function(el){el.addEventListener('click',function(){this.parentElement.classList.toggle('open');});});</script>
</body></html>`;
}

// ============ 知识库结构抓取 ============
async function buildTree(pt, depth, parentTitle) {
  const ns = await getNodes(pt);
  const tree = [];
  for (const n of ns) {
    if (n.node_token === CONFIG.ROOT_TOKEN && depth === 0) {
      if (n.has_child) { const cs = await buildTree(n.node_token, depth + 1, parentTitle); tree.push(...cs); }
      continue;
    }
    const title = n.title || '未命名';
    const breadcrumb = parentTitle ? `${parentTitle} › ${title}` : title;
    const tn = { node_token: n.node_token, title, obj_type: n.obj_type, obj_token: n.obj_token, children: [], breadcrumb };
    if (n.has_child) tn.children = await buildTree(n.node_token, depth + 1, breadcrumb);
    tree.push(tn);
    process.stdout.write('.');
  }
  return tree;
}

async function getNodes(pt) {
  const p = pt ? '/open-apis/wiki/v2/spaces/' + CONFIG.SPACE_ID + '/nodes?parent_node_token=' + pt : '/open-apis/wiki/v2/spaces/' + CONFIG.SPACE_ID + '/nodes';
  const d = await req('GET', p);
  return d.items || [];
}

// ============ 主流程 ============
async function main() {
  console.log('🚀 开始同步飞书知识库（完整版）...\n');
  if (!CONFIG.APP_ID || !CONFIG.APP_SECRET) { console.error('❌ 请设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET'); process.exit(1); }
  await getToken();
  console.log('✅ 已获取飞书访问凭证');

  // 初始化目录
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  const docsDir = path.join(CONFIG.OUTPUT_DIR, 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  if (!fs.existsSync(CONFIG.ASSETS_DIR)) fs.mkdirSync(CONFIG.ASSETS_DIR, { recursive: true });

  // 抓取结构
  console.log('\n📋 抓取知识库结构...');
  const tree = await buildTree('', 0);
  const nav = genNav(tree);
  console.log('\n✅ 共 ' + tree.length + ' 个节点');

  // 生成首页
  console.log('\n📄 生成首页...');
  fs.writeFileSync(path.join(CONFIG.OUTPUT_DIR, 'index.html'), indexPage(nav));

  // 生成文档页
  console.log('\n📄 生成文档页面...');
  let docCount = 0;
  async function processNode(nodes) {
    for (const n of nodes) {
      if (n.obj_type === 'docx' && n.obj_token) {
        try {
          process.stdout.write('[文]');
          const content = await getDocContent(n.obj_token);
          const html = docPage(nav, n.title, n.node_token, content, n.breadcrumb);
          fs.writeFileSync(path.join(docsDir, n.node_token + '.html'), html);
          docCount++;
        } catch(e) { process.stdout.write('[失]'); }
      }
      if (n.children && n.children.length) await processNode(n.children);
    }
  }
  await processNode(tree);

  console.log('\n\n✅ 同步完成！共 ' + docCount + ' 篇文档');
  console.log('📁 输出目录: ' + CONFIG.OUTPUT_DIR);
  console.log('📷 已下载图片: ' + Object.values(imgMap).filter(v => v && !v.startsWith('board')).length + ' 张');
}

main().catch(e => { console.error('\n❌ 失败:', e.message); process.exit(1); });
