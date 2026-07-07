# AllValue 帮助中心

基于飞书知识库生成的静态网站，帮助商家无需登录即可访问。

## 功能

- ✅ 完整还原知识库目录层级
- ✅ 全站搜索（标题搜索）
- ✅ 自动同步（每6小时）
- ✅ 响应式设计（手机/电脑）
- ✅ 无需登录即可访问
- ✅ 自定义域名支持
- ✅ 全球CDN加速（国内外均可访问）

## 快速开始

### 1. 创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建应用」→ 填写应用名称
3. 进入「权限管理」→ 开通以下权限：
   - `wiki:node:readonly` — 读取知识库节点
   - `docx:document:readonly` — 读取文档内容
4. 进入「版本管理与发布」→ 创建版本 → 发布

### 2. 配置知识库权限

1. 打开知识库设置
2. 将知识库设置为「对应用可见」或「对组织内可见」
3. 把刚才创建的应用添加到知识库成员

### 3. 创建 GitHub 仓库

1. 点击右上角 **Use this template** → Create a new repository
2. 仓库名：`allvalue-help-center`（可自定义）
3. 设为 **Private**（避免知识库内容泄露）

### 4. 上传代码

```bash
git clone https://github.com/你的用户名/allvalue-help-center.git
cd allvalue-help-center
git push origin main
```

### 5. 配置 GitHub Secrets

在 GitHub 仓库 → Settings → Secrets → Actions，添加：

| Secret 名称 | 值 |
|------------|-----|
| `FEISHU_APP_ID` | 飞书应用的 App ID |
| `FEISHU_APP_SECRET` | 飞书应用的 App Secret |
| `FEISHU_SPACE_ID` | 知识库 ID（可选，默认已有） |

### 6. 配置 Cloudflare Pages

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. 选择刚创建的 GitHub 仓库
4. 配置构建：
   - **Build command**: （留空）
   - **Build output directory**: `public`
5. 点击 **Save and Deploy**

### 7. 配置自定义域名（可选）

1. Cloudflare Pages → 你的项目 → **Custom domains**
2. 添加你的域名（如 `help.yourdomain.com`）
3. 按提示在域名注册商处添加 DNS 记录

## 手动同步

如果需要立即同步，可以：

1. GitHub 仓库 → **Actions** → **Sync Feishu Wiki** → **Run workflow**

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/你的用户名/allvalue-help-center.git
cd allvalue-help-center

# 安装依赖
npm install

# 配置环境变量
export FEISHU_APP_ID=你的AppID
export FEISHU_APP_SECRET=你的AppSecret

# 同步并构建
npm run sync
```

## 文件结构

```
help-center/
├── sync.js              # 同步脚本
├── package.json         # 依赖配置
├── .github/
│   └── workflows/
│       └── sync.yml     # GitHub Actions 自动同步
├── public/              # 生成的网站（自动生成）
│   ├── index.html       # 首页
│   └── docs/            # 各文档页面
└── README.md
```

## 常见问题

**Q: 文档内容获取失败？**  
A: 检查飞书应用的权限是否已开通并发布，知识库是否对应用可见。

**Q: 国内访问慢？**  
A: Cloudflare 在国内有节点，速度通常可以接受。如需更快，可考虑腾讯云COS+CDN方案。

**Q: 如何更新内容？**  
A: 直接在飞书知识库编辑，GitHub Actions 会在下一次定时任务（最多6小时后）自动同步。

## 技术栈

- **飞书 API** — 知识库内容获取
- **GitHub Actions** — 定时同步
- **Cloudflare Pages** — 网站托管与全球CDN
