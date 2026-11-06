import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const problems = [];

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));

const required = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);

for (const file of required) {
  if (!exists(file)) problems.push(`manifest 引用的文件不存在: ${file}`);
}

// HTML 资源与内联脚本检查（MV3 禁止内联脚本）
for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  const html = read(file);
  const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];
  for (const tag of scriptTags) {
    if (!/\bsrc=/.test(tag)) problems.push(`${file} 存在内联 <script>，会被 MV3 CSP 拦截`);
  }
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(https?:|#|data:)/.test(target)) continue;
    if (!exists(target)) problems.push(`${file} 引用了不存在的资源: ${target}`);
  }
}

function collectExports(file) {
  const code = read(file);
  const names = new Set();
  for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of code.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const jsFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(rel);
    } else if (entry.name.endsWith('.js')) {
      jsFiles.push(rel.replace(/\\/g, '/'));
    }
  }
}
walk('.');

for (const file of jsFiles) {
  const code = read(file);
  const dir = path.dirname(file);

  for (const match of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim())
      .filter(Boolean);
    const target = path.normalize(path.join(dir, match[2])).replace(/\\/g, '/');
    if (!exists(target)) {
      problems.push(`${file} 导入了不存在的模块: ${match[2]}`);
      continue;
    }
    const exported = collectExports(target);
    for (const name of names) {
      if (!exported.has(name)) problems.push(`${file} 从 ${match[2]} 导入了未导出的 ${name}`);
    }
  }

  for (const match of code.matchAll(/import\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.normalize(path.join(dir, match[1])).replace(/\\/g, '/');
    if (!exists(target)) problems.push(`${file} 导入了不存在的模块: ${match[1]}`);
  }
}

const icons = Object.values(manifest.icons ?? {}).map((file) => {
  const stat = fs.statSync(path.join(root, file));
  return `${file} ${stat.size}B`;
});

if (problems.length > 0) {
  console.error('检查失败:');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log(`manifest v${manifest.manifest_version} · ${manifest.name} ${manifest.version}`);
console.log(`JS 模块 ${jsFiles.length} 个 · HTML 入口 ${fs.readdirSync(root).filter((n) => n.endsWith('.html')).length} 个`);
console.log(`图标 ${icons.join(' · ')}`);
console.log('静态检查通过');
