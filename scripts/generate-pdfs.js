// scripts/generate-pdfs.js
// Hugo 构建后，遍历 public/ 里所有文章页面，渲染成 PDF 存到 public/pdf/
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const handler = require('serve-handler');
const http = require('http');

// 少量页面失败时不阻断部署的最大容忍失败数
const FAIL_THRESHOLD = 3;

// 内联 logo：Puppeteer headerTemplate 是独立 iframe，外链图片无法加载
const logoPath = path.join(__dirname, '..', 'static', 'favicon.svg');
const logoBase64 = fs.readFileSync(logoPath).toString('base64');
const logoDataUri = `data:image/svg+xml;base64,${logoBase64}`;

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PDF_DIR = path.join(PUBLIC_DIR, 'pdf');
// Hugo baseURL 的 path 前缀（不含 trailing slash）
const SITE_PATH_PREFIX = '/Crossing';
const PORT = 8787;
const BASE_URL = `http://localhost:${PORT}`;

async function startServer() {
  const server = http.createServer((req, res) => {
    // 把 /Crossing/... 剥掉前缀，让 serve-handler 从 public/ 根目录提供文件
    if (req.url.startsWith(SITE_PATH_PREFIX)) {
      req.url = req.url.slice(SITE_PATH_PREFIX.length) || '/';
    }
    return handler(req, res, { public: PUBLIC_DIR });
  });
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ 静态服务启动于 ${BASE_URL}${SITE_PATH_PREFIX}/`);
  return server;
}

// 生成单页 PDF，失败时自动重试一次（attempt 从 1 开始）
async function generateOne(browser, pageUrl, pdfRelPath, pdfFullPath, attempt) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');
    await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // 如果页面声明 no-pdf，跳过
    const noPdf = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="no-pdf"]');
      return meta && meta.getAttribute('content') === 'true';
    });

    if (noPdf) {
      await page.close();
      return 'skip';
    }

    // 等待所有图片加载
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((resolve) => {
                img.onload = img.onerror = resolve;
              })
          )
      )
    );

    fs.mkdirSync(path.dirname(pdfFullPath), { recursive: true });

    await page.pdf({
      path: pdfFullPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: '25mm', right: '15mm', bottom: '20mm', left: '15mm' },
      headerTemplate: `
        <div style="width:100%;font-size:9pt;color:#333;padding:4mm 15mm 0;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;">
            <img src="${logoDataUri}" style="width:24pt;height:24pt;vertical-align:middle;" />
            <span style="font-weight:600;font-size:11pt;">Crossing · 渡口</span>
          </div>
          <span class="title" style="color:#777;font-size:9pt;"></span>
        </div>`,
      footerTemplate: `
        <div style="width:100%;font-size:8pt;color:#999;padding:0 15mm;display:flex;justify-content:space-between;">
          <span class="url"></span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
    });

    await page.close();
    return attempt > 1 ? 'retry-success' : 'success';
  } catch (err) {
    try { await page.close(); } catch (_) {}
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      return generateOne(browser, pageUrl, pdfRelPath, pdfFullPath, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  const server = await startServer();

  // 找出所有 index.html，排除根页面、pdf 目录、其他非文章页
  const allHtmls = await glob('**/index.html', {
    cwd: PUBLIC_DIR,
    posix: true,
  });

  const articleHtmls = allHtmls.filter((p) => {
    if (p === 'index.html') return false;           // zh 首页
    if (p === 'en/index.html') return false;         // en 首页
    if (p.startsWith('pdf/')) return false;           // 已有 pdf 目录
    if (p.startsWith('categories/') || p.startsWith('tags/')) return false;
    return true;
  });

  console.log(`✓ 发现 ${articleHtmls.length} 个页面`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  // 清空并重建 pdf 目录（删掉旧文章对应的死 PDF）
  if (fs.existsSync(PDF_DIR)) {
    fs.rmSync(PDF_DIR, { recursive: true });
  }
  fs.mkdirSync(PDF_DIR, { recursive: true });

  let success = 0, skipped = 0, failed = 0;

  for (const htmlPath of articleHtmls) {
    const pageUrl = `${BASE_URL}${SITE_PATH_PREFIX}/${htmlPath}`;
    const pdfRelPath = htmlPath.replace(/index\.html$/, 'article.pdf');
    const pdfFullPath = path.join(PDF_DIR, pdfRelPath);

    try {
      const result = await generateOne(browser, pageUrl, pdfRelPath, pdfFullPath, 1);
      if (result === 'skip') {
        console.log(`⊘ 跳过（no_pdf）: ${htmlPath}`);
        skipped++;
      } else {
        if (result === 'retry-success') console.log(`⟳ 重试成功: ${pdfRelPath}`);
        else console.log(`✓ ${pdfRelPath}`);
        success++;
      }
    } catch (err) {
      console.error(`✗ ${htmlPath}: ${err.message}`);
      failed++;
    }
  }

  await browser.close();
  server.close();
  console.log(`\n完成：${success} 成功，${skipped} 跳过，${failed} 失败`);
  if (failed > FAIL_THRESHOLD) {
    process.exit(1);
  } else if (failed > 0) {
    console.warn(`⚠ 少量页面失败（${failed} 个）但不阻断部署`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
