import { CATEGORIES, CATEGORY_NAME } from './src/core/defaults.js';
import {
  listRepositories,
  getFavorites,
  toggleFavorite,
  getSnapshots,
  getRepository,
} from './src/core/store.js';
import {
  getLastTask,
  getSession,
  exportData,
  importData,
  clearAllData,
  getCounts,
} from './src/core/crawl.js';
import { getSettings, saveSettings } from './src/core/settings.js';
import { getAnalysis, analyzeRepository } from './src/core/ai.js';
import { createClient } from './src/core/github.js';
import {
  esc,
  compactNumber,
  number,
  delta as fmtDelta,
  timeAgo,
  dateTime,
  languageColor,
  growthTone,
} from './src/ui/format.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const crawlBtn = document.getElementById('crawlBtn');
const syncStatus = document.getElementById('syncStatus');
const topTitle = document.getElementById('topTitle');
const sideFoot = document.getElementById('sideFoot');

const state = {
  repos: [],
  favorites: new Set(),
  session: null,
  lastTask: null,
  route: 'discover',
  repoId: null,
  filters: { q: '', category: '', language: '', sort: 'stars', minStars: '' },
  page: 1,
  pageSize: 20,
};

const ROUTE_TITLES = {
  discover: '项目发现',
  trending: '今日热门',
  favorites: '我的收藏',
  settings: '设置',
  repo: '项目详情',
};

let toastTimer = null;

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 3200);
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  if (name === 'repo' && param) {
    state.route = 'repo';
    state.repoId = Number(param);
  } else if (['discover', 'trending', 'favorites', 'settings'].includes(name)) {
    state.route = name;
    state.repoId = null;
  } else {
    state.route = 'discover';
    state.repoId = null;
  }
}

async function loadAll() {
  const [repos, favorites, session, lastTask] = await Promise.all([
    listRepositories(),
    getFavorites(),
    getSession(),
    getLastTask(),
  ]);
  state.repos = repos;
  state.favorites = favorites;
  state.session = session;
  state.lastTask = lastTask;
}

function statusText() {
  const { session, lastTask } = state;
  if (session) {
    if (session.phase === 'search') {
      return { text: `搜索中 ${session.queryIndex}/${session.queries.length}`, cls: 'busy' };
    }
    return {
      text: `采集中 ${session.cursor}/${session.candidates.length}`,
      cls: 'busy',
    };
  }
  if (lastTask) {
    return { text: `上次采集 ${timeAgo(lastTask.finishedAt)}`, cls: 'ok' };
  }
  return { text: '未采集', cls: '' };
}

function renderStatus() {
  const status = statusText();
  syncStatus.innerHTML = `<span class="status-dot ${status.cls}"></span>${esc(status.text)}`;
  crawlBtn.disabled = Boolean(state.session);
  crawlBtn.textContent = state.session ? '采集中…' : '立即采集';
  sideFoot.textContent = `${state.repos.length} 个项目 · 数据仅存本机`;
}

function setActiveNav() {
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active =
      link.dataset.nav === state.route ||
      (state.route === 'repo' && link.dataset.nav === 'discover');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  topTitle.textContent = ROUTE_TITLES[state.route] ?? 'GitHub Radar';
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function baseStats() {
  const today = todayStart();
  const updatedToday = state.repos.filter((repo) => (repo.lastFetchedAt ?? 0) >= today).length;
  const withGrowth = state.repos.filter((repo) => typeof repo.stars24h === 'number');
  const growthSum = withGrowth.reduce((sum, repo) => sum + repo.stars24h, 0);
  const fast = state.repos.filter((repo) => (repo.stars24h ?? 0) >= 100).length;
  return {
    total: state.repos.length,
    updatedToday,
    growthSum: withGrowth.length > 0 ? growthSum : null,
    fast,
    growthReady: withGrowth.length,
  };
}

function renderStats() {
  const stats = baseStats();
  return `
    <section class="stats">
      <div class="stat"><div class="stat-label">跟踪项目</div><div class="stat-value">${compactNumber(stats.total)}</div><div class="stat-hint">${new Set(state.repos.map((r) => r.category)).size} 个分类有数据</div></div>
      <div class="stat"><div class="stat-label">今日更新</div><div class="stat-value">${compactNumber(stats.updatedToday)}</div><div class="stat-hint">最近一次采集覆盖</div></div>
      <div class="stat"><div class="stat-label">24h Star 增长</div><div class="stat-value ${stats.growthSum > 0 ? 'up' : ''}">${stats.growthSum === null ? '—' : fmtDelta(stats.growthSum)}</div><div class="stat-hint">${stats.growthSum === null ? '需要 24h 前的快照' : `${stats.growthReady} 个项目有数据`}</div></div>
      <div class="stat"><div class="stat-label">快速增长</div><div class="stat-value">${compactNumber(stats.fast)}</div><div class="stat-hint">24h 新增 ≥ 100</div></div>
    </section>`;
}

function filteredRepos() {
  let rows = state.repos.slice();

  if (state.route === 'favorites') {
    rows = rows.filter((repo) => state.favorites.has(repo.id));
  }
  if (state.route === 'trending') {
    rows = rows.filter((repo) => typeof repo.stars24h === 'number');
  }

  const { q, category, language, minStars } = state.filters;
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((repo) =>
      `${repo.fullName} ${repo.description} ${repo.language} ${(repo.topics ?? []).join(' ')}`
        .toLowerCase()
        .includes(needle),
    );
  }
  if (category) rows = rows.filter((repo) => repo.category === category);
  if (language) rows = rows.filter((repo) => repo.language === language);
  if (minStars) rows = rows.filter((repo) => repo.stars >= Number(minStars));

  const sorters = {
    growth24: (a, b) => (b.stars24h ?? -Infinity) - (a.stars24h ?? -Infinity),
    growth7: (a, b) => (b.stars7d ?? -Infinity) - (a.stars7d ?? -Infinity),
    stars: (a, b) => b.stars - a.stars,
    updated: (a, b) => (b.updatedAtGithub ?? 0) - (a.updatedAtGithub ?? 0),
    created: (a, b) => (b.createdAtGithub ?? 0) - (a.createdAtGithub ?? 0),
  };
  const sortKey = state.route === 'trending' ? 'growth24' : state.filters.sort;
  rows.sort(sorters[sortKey] ?? sorters.stars);
  return rows;
}

function languageOptions() {
  const languages = Array.from(new Set(state.repos.map((repo) => repo.language).filter(Boolean))).sort();
  return languages.map((lang) => `<option value="${esc(lang)}">${esc(lang)}</option>`).join('');
}

function categoryOptions() {
  return CATEGORIES.map(
    (category) => `<option value="${category.slug}">${esc(category.name)}</option>`,
  ).join('');
}

function repoRow(repo) {
  const favorite = state.favorites.has(repo.id);
  const tone = growthTone(repo.stars24h);
  const tags = (repo.tags ?? []).slice(0, 2);
  return `
    <div class="repo-row" data-repo="${repo.id}">
      <div class="repo-main">
        <div class="repo-title">
          <span class="repo-name">${esc(repo.name)}</span>
          <span class="repo-owner">/ ${esc(repo.owner)}</span>
          ${tags.map((tag) => `<span class="badge ${tag === 'fast' ? 'success' : ''}">${esc(tagLabel(tag))}</span>`).join('')}
        </div>
        <p class="repo-desc">${repo.description ? esc(repo.description) : '<span class="muted">暂无描述</span>'}</p>
        <div class="repo-meta">
          <span class="badge accent">${esc(CATEGORY_NAME[repo.category] ?? '其他')}</span>
          ${repo.language ? `<span><i class="lang-dot" style="background:${languageColor(repo.language)}"></i>${esc(repo.language)}</span>` : ''}
          <span>★ ${compactNumber(repo.stars)}</span>
          <span>⑂ ${compactNumber(repo.forks)}</span>
          <span>${esc(timeAgo(repo.updatedAtGithub))}更新</span>
        </div>
      </div>
      <div class="repo-side">
        <div class="metric">
          <div class="metric-value ${tone}">${fmtDelta(repo.stars24h)}</div>
          <div class="metric-label" title="${repo.window24hHours ? `实际窗口 ${repo.window24hHours.toFixed(1)} 小时` : '需要 24 小时前的快照'}">24h</div>
        </div>
        <button class="icon-btn ${favorite ? 'on' : ''}" data-fav="${repo.id}" title="${favorite ? '取消收藏' : '收藏'}" aria-label="${favorite ? '取消收藏' : '收藏'}">${favorite ? '★' : '☆'}</button>
        <a class="icon-btn" href="${esc(repo.url)}" target="_blank" rel="noopener noreferrer" title="在 GitHub 打开">↗</a>
      </div>
    </div>`;
}

function tagLabel(tag) {
  return (
    { new: '新项目', fast: '快速增长', sustained: '持续增长', hot: '高热度', slowing: '增长放缓', long_term: '长期热门' }[
      tag
    ] ?? tag
  );
}

function emptyRowsHtml() {
  if (state.route === 'trending') {
    return `<div class="empty">
      <div class="empty-icon">↗</div>
      <div class="empty-title">还没有 24h 增长数据</div>
      <div class="empty-desc">增长值需要间隔 24 小时以上的两条快照。首次采集后，等下一次采集完成才会出现；系统不会用 Star 总量推算。</div>
      <div style="margin-top:12px"><button class="btn btn-primary" data-action="crawl">立即采集</button></div>
    </div>`;
  }
  if (state.route === 'favorites') {
    return `<div class="empty">
      <div class="empty-icon">☆</div>
      <div class="empty-title">还没有收藏</div>
      <div class="empty-desc">在项目列表或详情页点击星标，就会出现在这里。收藏保存在本地数据库。</div>
      <div style="margin-top:12px"><a class="btn" href="#/discover">去发现项目</a></div>
    </div>`;
  }
  return `<div class="empty">
    <div class="empty-icon">∅</div>
    <div class="empty-title">没有匹配的项目</div>
    <div class="empty-desc">换个关键词或清除筛选条件再试。</div>
    <div style="margin-top:12px"><button class="btn" data-action="reset">清除筛选</button></div>
  </div>`;
}

function renderList() {
  const isFavorites = state.route === 'favorites';
  const isTrending = state.route === 'trending';
  const rows = filteredRepos();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  const onboarding =
    state.repos.length === 0
      ? `<div class="empty">
           <div class="empty-icon">◉</div>
           <div class="empty-title">还没有数据</div>
           <div class="empty-desc">三步开始：① 在设置里填入 GitHub Token ② 点击右上角「立即采集」③ 等待 24 小时后出现真实增长数据。采集只发生在你的浏览器里。</div>
           <div style="margin-top:14px;display:flex;gap:8px;justify-content:center">
             <a class="btn" href="#/settings">去设置</a>
             <button class="btn btn-primary" data-action="crawl">立即采集</button>
           </div>
         </div>`
      : '';

  app.innerHTML = `
    ${renderStats()}
    <div class="page-head">
      <div>
        <h1>${isFavorites ? '我的收藏' : isTrending ? '今日热门' : '项目发现'}</h1>
        <p class="page-sub">${
          isFavorites
            ? '收藏保存在本地数据库，可导出为 JSON。'
            : isTrending
              ? '按 24 小时 Star 增长排序，只显示有真实快照差值的项目。'
              : '自动采集最近创建与活跃的 GitHub 项目，按分类、语言和增长筛选。'
        }</p>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="input search" id="q" placeholder="搜索项目、作者、描述或话题" value="${esc(state.filters.q)}" />
        ${isFavorites ? '' : `<select class="select" id="category"><option value="">全部分类</option>${categoryOptions()}</select>`}
        <select class="select" id="language"><option value="">全部语言</option>${languageOptions()}</select>
        <select class="select" id="sort">
          <option value="growth24"${state.filters.sort === 'growth24' ? ' selected' : ''}>24h 增长</option>
          <option value="growth7"${state.filters.sort === 'growth7' ? ' selected' : ''}>7d 增长</option>
          <option value="stars"${state.filters.sort === 'stars' ? ' selected' : ''}>Star 总量</option>
          <option value="updated"${state.filters.sort === 'updated' ? ' selected' : ''}>最近更新</option>
          <option value="created"${state.filters.sort === 'created' ? ' selected' : ''}>最近创建</option>
        </select>
        <input class="input" id="minStars" type="number" min="0" placeholder="Star ≥" style="width:86px" value="${esc(state.filters.minStars)}" />
        <button class="btn" data-action="reset" type="button">重置</button>
      </div>
      <div id="rows">
        ${onboarding}
        ${pageRows.map(repoRow).join('')}
        ${
          state.repos.length > 0 && rows.length === 0 ? emptyRowsHtml() : ''
        }
      </div>
      <div class="pager" id="pager">
        <span>共 ${rows.length} 个项目 · 第 ${state.page} / ${totalPages} 页</span>
        <span class="pager-btns">
          <button class="btn" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="btn" data-page="${state.page + 1}" ${state.page >= totalPages ? 'disabled' : ''}>下一页</button>
        </span>
      </div>
    </div>`;

  const q = document.getElementById('q');
  q?.addEventListener('input', () => {
    state.filters.q = q.value.trim();
    state.page = 1;
    updateRows();
  });
  document.getElementById('category')?.addEventListener('change', (event) => {
    state.filters.category = event.target.value;
    state.page = 1;
    updateRows();
  });
  document.getElementById('language')?.addEventListener('change', (event) => {
    state.filters.language = event.target.value;
    state.page = 1;
    updateRows();
  });
  document.getElementById('sort')?.addEventListener('change', (event) => {
    state.filters.sort = event.target.value;
    updateRows();
  });
  document.getElementById('minStars')?.addEventListener('change', (event) => {
    state.filters.minStars = event.target.value;
    state.page = 1;
    updateRows();
  });
}

function updateRows() {
  if (state.repos.length === 0) {
    renderList();
    return;
  }
  const rows = filteredRepos();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  const rowsEl = document.getElementById('rows');
  if (rowsEl) {
    rowsEl.innerHTML = pageRows.map(repoRow).join('') || emptyRowsHtml();
  }
  const pager = document.getElementById('pager');
  if (pager) {
    pager.innerHTML = `
      <span>共 ${rows.length} 个项目 · 第 ${state.page} / ${totalPages} 页</span>
      <span class="pager-btns">
        <button class="btn" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn" data-page="${state.page + 1}" ${state.page >= totalPages ? 'disabled' : ''}>下一页</button>
      </span>`;
  }
}

function drawChart(canvas, snapshots) {
  const points = snapshots.slice().reverse();
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  const height = 90;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (points.length < 2) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--subtle');
    ctx.font = '12px system-ui';
    ctx.fillText('至少需要两条快照才能画趋势', 10, height / 2);
    return;
  }

  const values = points.map((p) => p.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 8;
  const x = (i) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v) => (max === min ? height / 2 : height - pad - ((v - min) / (max - min)) * (height - pad * 2));

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim();
  const border = styles.getPropertyValue('--border').trim();

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(index), y(point.stars));
    else ctx.lineTo(x(index), y(point.stars));
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.lineTo(x(points.length - 1), height);
  ctx.lineTo(x(0), height);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.1;
  ctx.fill();
  ctx.globalAlpha = 1;
}

async function renderDetail() {
  const repo = await getRepository(state.repoId);
  if (!repo) {
    app.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">项目不存在</div><div class="empty-desc">可能已被清理，返回列表重新选择。</div><div style="margin-top:12px"><a class="btn" href="#/discover">返回列表</a></div></div></div>`;
    return;
  }

  const snapshots = await getSnapshots(repo.id, 120);
  const analysis = await getAnalysis(repo.id);
  const favorite = state.favorites.has(repo.id);
  const tone = growthTone(repo.stars24h);

  app.innerHTML = `
    <div class="page-head">
      <div>
        <p class="page-sub" style="margin:0 0 4px"><a href="#/discover" style="color:var(--accent)">← 返回列表</a></p>
        <h1>${esc(repo.name)} <span class="muted" style="font-weight:400;font-size:14px">/ ${esc(repo.owner)}</span></h1>
        <p class="page-sub">${repo.description ? esc(repo.description) : '暂无描述'}</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn ${favorite ? '' : 'btn-primary'}" data-fav="${repo.id}">${favorite ? '★ 已收藏' : '☆ 收藏'}</button>
        <a class="btn" href="${esc(repo.url)}" target="_blank" rel="noopener noreferrer">打开 GitHub ↗</a>
      </div>
    </div>

    <section class="detail-grid">
      <div class="stat"><div class="stat-label">Star</div><div class="stat-value">${number(repo.stars)}</div><div class="stat-hint">Fork ${number(repo.forks)}</div></div>
      <div class="stat"><div class="stat-label">24h 增长</div><div class="stat-value ${tone}">${fmtDelta(repo.stars24h)}</div><div class="stat-hint">${repo.window24hHours ? `窗口 ${repo.window24hHours.toFixed(1)}h` : '数据不足'}</div></div>
      <div class="stat"><div class="stat-label">7 天增长</div><div class="stat-value ${growthTone(repo.stars7d)}">${fmtDelta(repo.stars7d)}</div><div class="stat-hint">${repo.window7dHours ? `窗口 ${(repo.window7dHours / 24).toFixed(1)} 天` : '数据不足'}</div></div>
      <div class="stat"><div class="stat-label">Open Issues</div><div class="stat-value">${number(repo.issues)}</div><div class="stat-hint">${esc(repo.language || '未知语言')}</div></div>
    </section>

    <div class="panel">
      <h2>Star 历史（${snapshots.length} 个快照）</h2>
      <canvas class="chart" id="chart"></canvas>
      <p style="margin-top:6px;font-size:11px">快照只追加不覆盖，增长数值全部来自相邻快照差值。</p>
    </div>

    <div class="panel">
      <h2>项目信息</h2>
      <dl class="kv">
        <dt>分类</dt><dd>${esc(CATEGORY_NAME[repo.category] ?? '其他')} <span class="muted">（${repo.categorySource === 'rule' ? `规则匹配 ${((repo.categoryConfidence ?? 0) * 100).toFixed(0)}%` : '未分类'}）</span></dd>
        <dt>标签</dt><dd>${(repo.tags ?? []).length ? (repo.tags ?? []).map((tag) => `<span class="badge">${esc(tagLabel(tag))}</span>`).join(' ') : '<span class="muted">暂无</span>'}</dd>
        <dt>License</dt><dd>${esc(repo.licenseName || repo.license || '未声明')}</dd>
        <dt>主页</dt><dd>${repo.homepage ? `<a href="${esc(repo.homepage)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${esc(repo.homepage)}</a>` : '<span class="muted">无</span>'}</dd>
        <dt>创建时间</dt><dd>${esc(dateTime(repo.createdAtGithub))}</dd>
        <dt>最近推送</dt><dd>${esc(timeAgo(repo.pushedAtGithub))}</dd>
        <dt>最近采集</dt><dd>${esc(timeAgo(repo.lastFetchedAt))}</dd>
        <dt>数据来源</dt><dd>${esc((repo.discoveredVia ?? []).join(' · ') || '—')}</dd>
      </dl>
    </div>

    ${renderAiPanel(analysis, repo)}

    <div class="panel">
      <h2>最近快照</h2>
      ${
        snapshots.length === 0
          ? '<p class="muted">还没有快照。</p>'
          : `<table style="width:100%;font-size:12px;border-collapse:collapse">
              <thead><tr style="text-align:left;color:var(--subtle)"><th style="padding:4px 0">时间</th><th>Star</th><th>Fork</th><th>变化</th></tr></thead>
              <tbody>${snapshots
                .slice(0, 8)
                .map((snapshot, index) => {
                  const prev = snapshots[index + 1];
                  const change = prev ? snapshot.stars - prev.stars : null;
                  return `<tr><td style="padding:3px 0">${esc(dateTime(snapshot.capturedAt))}</td><td>${number(snapshot.stars)}</td><td>${number(snapshot.forks)}</td><td class="${change > 0 ? 'up' : change < 0 ? 'down' : 'muted'}">${change === null ? '—' : fmtDelta(change)}</td></tr>`;
                })
                .join('')}</tbody>
            </table>`
      }
    </div>`;

  drawChart(document.getElementById('chart'), snapshots);
}

function listBlock(items) {
  if (!items || items.length === 0) return '<span class="muted">未知</span>';
  return `<ul class="clean">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function renderAiPanel(record, repo) {
  const configured = Boolean(state.settings?.aiEnabled && state.settings?.aiApiKey);
  const head = `<div class="card-head"><div><div class="card-title">AI 商业分析</div><div class="card-sub">基于元数据与 README 的估算，不是客观事实</div></div>${record ? '<span class="badge warn">AI 估算</span>' : ''}</div>`;

  if (!record) {
    return `<div class="card" style="margin-bottom:14px">${head}
      <div class="form-grid">
        <p class="muted" style="margin:0;font-size:12px;line-height:1.7">生成：解决的问题、目标用户、盈利模式、竞品差异、技术成熟度、二次开发难度、基础设施成本、MVP 方向、风险，以及 0–100 分商业价值评分（含依据与置信度）。信息不足会明确标记“未知”。</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" data-ai="analyze" ${configured ? '' : 'disabled'}>开始分析</button>
          <span class="muted" style="font-size:11px">${configured ? '会先读取 README，再调用你配置的 AI 接口；结果只存在本地' : '需先在设置中启用 AI 并填写 Key'}</span>
        </div>
      </div>
    </div>`;
  }

  const a = record.analysis;
  const score = a.score ?? null;
  const confidence = Math.round((a.confidence ?? 0) * 100);

  const breakdown = a.scoreBreakdown.length
    ? `<div class="breakdown">${a.scoreBreakdown
        .map(
          (item) => `
          <div class="breakdown-row">
            <span class="breakdown-label">${esc(item.label)}</span>
            <span class="bar"><span class="bar-fill" style="width:${item.score}%"></span></span>
            <span class="breakdown-score">${item.score}</span>
            <span class="breakdown-reason">${esc(item.reason)}</span>
          </div>`,
        )
        .join('')}</div>`
    : '<p class="muted">模型未给出分维度评分。</p>';

  return `<div class="card" style="margin-bottom:14px">${head}
    <div class="ai-top">
      <div class="score">
        <div class="score-value ${score === null ? 'muted' : ''}">${score === null ? '—' : score}</div>
        <div class="score-label">商业价值 / 100</div>
        <div class="score-conf">置信度 ${confidence}%</div>
      </div>
      <div class="ai-summary">
        <p>${esc(a.summaryZh || '未知')}</p>
        <div class="muted" style="font-size:10.5px;margin-top:6px">${esc(record.model)} · ${esc(dateTime(record.createdAt))} · 提示词 ${esc(record.promptVersion)}</div>
      </div>
    </div>
    <div class="ai-grid">
      <section><h3>解决的问题</h3><p>${esc(a.problem)}</p></section>
      <section><h3>目标用户</h3>${listBlock(a.targetUsers)}</section>
      <section><h3>需求信号</h3>${listBlock(a.marketSignals)}</section>
      <section><h3>盈利模式</h3>${listBlock(a.monetization)}</section>
      <section><h3>竞品与差异化</h3>${
        a.competitors.length
          ? `<ul class="clean">${a.competitors.map((c) => `<li><strong>${esc(c.name)}</strong> — ${esc(c.difference)}</li>`).join('')}</ul>`
          : '<span class="muted">未知</span>'
      }</section>
      <section><h3>技术成熟度</h3><p>${esc(a.maturity)}</p><h3 style="margin-top:8px">二次开发难度</h3><p>${esc(a.devEffort)}</p></section>
      <section><h3>可复用</h3>${listBlock(a.reusable)}</section>
      <section><h3>还缺什么</h3>${listBlock(a.missing)}</section>
      <section><h3>基础设施成本</h3><p>${esc(a.infraCost)}</p></section>
      <section><h3>MVP 方向</h3><p>${esc(a.mvp)}</p></section>
      <section><h3>风险</h3>${listBlock(a.risks)}</section>
      <section><h3>未知项</h3>${listBlock(a.unknowns)}</section>
    </div>
    <div class="ai-foot">
      <h3>评分依据</h3>
      ${breakdown}
      <h3 style="margin-top:10px">证据</h3>
      ${listBlock(a.evidence)}
      <div style="margin-top:12px"><button class="btn" data-ai="analyze" ${configured ? '' : 'disabled'}>重新分析</button></div>
    </div>
  </div>`;
}

async function runAnalysis() {
  const repo = await getRepository(state.repoId);
  if (!repo) return;
  const settings = state.settings ?? (await getSettings());
  const button = document.querySelector('[data-ai="analyze"]');
  if (button) {
    button.disabled = true;
    button.textContent = '分析中…（读取 README + 调用模型）';
  }
  try {
    const client = createClient(settings.githubToken);
    let readme = '';
    try {
      readme = await client.getReadme(repo.fullName);
    } catch {
      readme = '';
    }
    const record = await analyzeRepository(repo, settings, readme);
    toast(`分析完成：${record.analysis.score ?? '—'} 分`);
    await renderDetail();
  } catch (error) {
    toast(`分析失败：${error.message}`, true);
    if (button) {
      button.disabled = false;
      button.textContent = '重试分析';
    }
  }
}

function renderSettings() {
  const tokenConfigured = Boolean(state.settings?.githubToken);
  const counts = state.counts ?? { repos: state.repos.length, snapshots: 0 };

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>设置</h1>
        <p class="page-sub">所有配置与数据只保存在这台电脑的浏览器里，不会上传到任何服务器。</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">GitHub 接入</div><div class="card-sub">用于发现项目与记录 Star 快照</div></div>
        <span class="badge ${tokenConfigured ? 'success' : 'warn'}">${tokenConfigured ? '已配置' : '未配置'}</span>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="token">Personal Access Token</label>
          <input id="token" class="input" type="password" placeholder="ghp_… 或 github_pat_…" value="${esc(state.settings?.githubToken ?? '')}" autocomplete="off" />
          <div class="hint">未配置时每小时只有 60 次请求，只能小范围体验；配置后 5,000 次/小时。建议使用 fine-grained token，仅授予 Public Repositories 只读权限。</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div><div class="card-title">AI 分析（OpenAI 兼容）</div><div class="card-sub">Key 只存本机，不经过任何自建服务器</div></div>
        <span class="badge ${state.settings?.aiEnabled ? 'success' : ''}">${state.settings?.aiEnabled ? '已启用' : '未启用'}</span>
      </div>
      <div class="form-grid">
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px">
          <input id="aiEnabled" type="checkbox" ${state.settings?.aiEnabled ? 'checked' : ''} />
          启用 AI 分析
        </label>
        <div class="field">
          <label for="aiBaseUrl">Base URL</label>
          <input id="aiBaseUrl" class="input" placeholder="https://api.deepseek.com/v1" value="${esc(state.settings?.aiBaseUrl ?? '')}" />
          <div class="hint">保存时会向 Chrome 申请访问该域名的权限。换域名需要重新授权。</div>
        </div>
        <div class="field">
          <label for="aiKey">API Key</label>
          <input id="aiKey" class="input" type="password" placeholder="sk-…" value="${esc(state.settings?.aiApiKey ?? '')}" autocomplete="off" />
        </div>
        <div class="field">
          <label for="aiModel">模型名</label>
          <input id="aiModel" class="input" placeholder="deepseek-chat" value="${esc(state.settings?.aiModel ?? '')}" />
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head"><div><div class="card-title">采集</div><div class="card-sub">浏览器开着时才执行，关闭后不承诺继续</div></div></div>
      <div class="form-grid">
        <div class="field">
          <label for="interval">采集间隔</label>
          <select id="interval" class="input">
            ${[
              [60, '每 1 小时'],
              [180, '每 3 小时'],
              [360, '每 6 小时'],
              [720, '每 12 小时'],
              [1440, '每天一次'],
            ]
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${Number(state.settings?.crawlIntervalMinutes) === value ? 'selected' : ''}>${label}</option>`,
              )
              .join('')}
          </select>
        </div>
        <div class="field">
          <label for="maxDetail">单轮最多同步仓库数</label>
          <input id="maxDetail" class="input" type="number" min="10" max="500" value="${Number(state.settings?.maxDetailPerCrawl ?? 120)}" />
          <div class="hint">每轮采集会分成多次小任务执行，避免被浏览器回收。</div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn btn-primary" id="saveSettings" type="button">保存设置</button>
        <span id="saveHint" class="muted" style="font-size:11px"></span>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head"><div><div class="card-title">数据</div><div class="card-sub">${number(counts.repos)} 个项目 · ${number(counts.snapshots)} 条快照</div></div></div>
      <div class="row-actions" style="padding-top:15px">
        <button class="btn" id="exportBtn" type="button">导出 JSON</button>
        <button class="btn" id="importBtn" type="button">导入 JSON</button>
        <input id="importFile" type="file" accept="application/json" style="display:none" />
        <button class="btn btn-danger" id="clearBtn" type="button">清空本地数据</button>
        <span class="muted" style="font-size:11px">建议定期导出备份，清除浏览器数据会丢</span>
      </div>
    </div>

    <div class="notice" style="margin-top:14px">
      隐私说明：GitHub Token 与 AI Key 保存在 chrome.storage.local，仅本扩展可读；数据存在 IndexedDB。卸载扩展或清除浏览器数据会一起删除，请用导出功能备份。
    </div>`;

  document.getElementById('saveSettings')?.addEventListener('click', saveSettingsHandler);
  document.getElementById('exportBtn')?.addEventListener('click', exportHandler);
  document.getElementById('importBtn')?.addEventListener('click', () => {
    document.getElementById('importFile')?.click();
  });
  document.getElementById('importFile')?.addEventListener('change', importHandler);
  document.getElementById('clearBtn')?.addEventListener('click', clearHandler);
}

async function saveSettingsHandler(event) {
  const aiBaseUrl = document.getElementById('aiBaseUrl')?.value.trim() ?? '';

  if (aiBaseUrl) {
    try {
      const origin = new URL(aiBaseUrl).origin;
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) toast('未授权访问该 AI 域名，AI 调用会失败', true);
    } catch {
      toast('AI Base URL 不是合法地址', true);
      return;
    }
  }

  const patch = {
    githubToken: document.getElementById('token')?.value.trim() ?? '',
    aiEnabled: Boolean(document.getElementById('aiEnabled')?.checked),
    aiBaseUrl,
    aiApiKey: document.getElementById('aiKey')?.value.trim() ?? '',
    aiModel: document.getElementById('aiModel')?.value.trim() ?? '',
    crawlIntervalMinutes: Number(document.getElementById('interval')?.value ?? 360),
    maxDetailPerCrawl: Number(document.getElementById('maxDetail')?.value ?? 120),
  };

  state.settings = await saveSettings(patch);
  await chrome.runtime.sendMessage({ type: 'settings:updated' }).catch(() => null);
  toast('已保存');
  const hint = document.getElementById('saveHint');
  if (hint) hint.textContent = '已保存 · 采集间隔已生效';
  renderStatus();
  renderSettings();
}

async function exportHandler() {
  const data = await exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `github-radar-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast(`已导出 ${data.repos.length} 个项目`);
}

async function importHandler(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const result = await importData(payload);
    toast(`已导入 ${result.repos} 个项目 / ${result.snapshots} 条快照`);
    await loadAll();
    render();
  } catch (error) {
    toast(`导入失败：${error.message}`, true);
  }
}

async function clearHandler() {
  if (!confirm('确定清空本地所有项目、快照和收藏？此操作不可撤销，建议先导出。')) return;
  await clearAllData();
  await loadAll();
  render();
  toast('本地数据已清空');
}

async function render() {
  renderStatus();
  setActiveNav();

  if (state.route === 'settings') {
    state.settings = await getSettings();
    state.counts = await getCounts();
    renderSettings();
    return;
  }
  if (state.route === 'repo') {
    await renderDetail();
    return;
  }
  renderList();
}

async function startCrawl() {
  crawlBtn.disabled = true;
  crawlBtn.textContent = '采集中…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'crawl:start' });
    if (!result?.ok) throw new Error(result?.error ?? '启动失败');
    toast('采集已开始，可在列表上方查看进度');
  } catch (error) {
    toast(`采集启动失败：${error.message}`, true);
  }
  await refreshStatus();
}

async function refreshStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'crawl:status' });
    if (status?.ok) {
      state.session = status.session;
      state.lastTask = status.lastTask;
      renderStatus();
      if (!state.session && state.lastTask) {
        await loadAll();
        if (state.route !== 'settings') render();
      }
    }
  } catch {
    // Service Worker 未启动时忽略
  }
}

app.addEventListener('click', async (event) => {
  const aiBtn = event.target.closest('[data-ai]');
  if (aiBtn) {
    event.stopPropagation();
    if (!aiBtn.disabled) await runAnalysis();
    return;
  }

  const favBtn = event.target.closest('[data-fav]');
  if (favBtn) {
    event.stopPropagation();
    const id = Number(favBtn.dataset.fav);
    const added = await toggleFavorite(id);
    if (added) state.favorites.add(id);
    else state.favorites.delete(id);
    if (state.route === 'favorites' || state.route === 'repo') render();
    else updateRows();
    toast(added ? '已收藏' : '已取消收藏');
    return;
  }

  const pageBtn = event.target.closest('[data-page]');
  if (pageBtn && !pageBtn.disabled) {
    state.page = Number(pageBtn.dataset.page);
    updateRows();
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    if (action.dataset.action === 'crawl') await startCrawl();
    if (action.dataset.action === 'reset') {
      state.filters = { q: '', category: '', language: '', sort: 'growth24', minStars: '' };
      state.page = 1;
      render();
    }
    return;
  }

  const row = event.target.closest('[data-repo]');
  if (row && !event.target.closest('a') && !event.target.closest('button')) {
    location.hash = `#/repo/${row.dataset.repo}`;
  }
});

crawlBtn.addEventListener('click', () => void startCrawl());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'radar:changed') return;
  if (document.activeElement?.tagName === 'INPUT') {
    void refreshStatus();
    return;
  }
  void refreshStatus();
});

window.addEventListener('hashchange', () => {
  parseRoute();
  render();
});

window.addEventListener('resize', () => {
  if (state.route === 'repo' && state.repoId) {
    const canvas = document.getElementById('chart');
    if (canvas) void getSnapshots(state.repoId, 120).then((rows) => drawChart(canvas, rows));
  }
});

async function boot() {
  parseRoute();
  await loadAll();
  state.settings = await getSettings();
  render();

  const status = await chrome.runtime.sendMessage({ type: 'crawl:status' }).catch(() => null);
  if (status?.ok) {
    state.session = status.session;
    state.lastTask = status.lastTask;
  }
  renderStatus();
  if (state.session) {
    setInterval(() => void refreshStatus(), 5000);
  }
}

void boot();
