import { listRepositories, getFavorites } from './src/core/store.js';
import { getSession, getLastTask } from './src/core/crawl.js';
import { compactNumber, esc, delta as fmtDelta, timeAgo } from './src/ui/format.js';

const listEl = document.getElementById('list');
const statsEl = document.getElementById('stats');
const statusEl = document.getElementById('status');
const crawlBtn = document.getElementById('crawl');

let state = { repos: [], favorites: new Set(), session: null, lastTask: null };

function openDashboard(hash = '') {
  const url = chrome.runtime.getURL(`dashboard.html${hash}`);
  chrome.tabs.create({ url });
  window.close();
}

function statusLine() {
  if (state.session) {
    if (state.session.phase === 'search') return '正在搜索新项目…';
    return `采集中 ${state.session.cursor}/${state.session.candidates.length}`;
  }
  if (state.lastTask) {
    return `上次采集 ${timeAgo(state.lastTask.finishedAt)} · 新增 ${state.lastTask.saved}`;
  }
  return '尚未采集';
}

function render() {
  const withGrowth = state.repos.filter((repo) => typeof repo.stars24h === 'number');
  const growthSum = withGrowth.reduce((sum, repo) => sum + repo.stars24h, 0);

  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">跟踪项目</div><div class="stat-value">${compactNumber(state.repos.length)}</div></div>
    <div class="stat"><div class="stat-label">24h 增长</div><div class="stat-value ${growthSum > 0 ? 'up' : ''}">${withGrowth.length ? fmtDelta(growthSum) : '—'}</div></div>`;

  const top = state.repos
    .slice()
    .sort((a, b) => (b.stars24h ?? -Infinity) - (a.stars24h ?? -Infinity) || b.stars - a.stars)
    .slice(0, 5);

  if (top.length === 0) {
    listEl.innerHTML = `<div class="empty">还没有采集到项目。<br />打开面板，填入 GitHub Token 后点击「立即采集」。</div>`;
  } else {
    listEl.innerHTML = top
      .map(
        (repo) => `
        <button class="repo" data-id="${repo.id}" type="button">
          <span class="repo-main">
            <span class="repo-name">${esc(repo.fullName)}</span>
            <span class="repo-meta">★ ${compactNumber(repo.stars)} · ${esc(repo.language || '未知')}</span>
          </span>
          <span class="growth ${(repo.stars24h ?? 0) > 0 ? 'up' : 'muted'}">${fmtDelta(repo.stars24h)}</span>
        </button>`,
      )
      .join('');
  }

  statusEl.textContent = statusLine();
  crawlBtn.disabled = Boolean(state.session);
  crawlBtn.textContent = state.session ? '采集中…' : '立即采集';
}

async function load() {
  const [repos, favorites, session, lastTask] = await Promise.all([
    listRepositories(),
    getFavorites(),
    getSession(),
    getLastTask(),
  ]);
  state = { repos, favorites, session, lastTask };
  render();
}

listEl.addEventListener('click', (event) => {
  const row = event.target.closest('[data-id]');
  if (row) openDashboard(`#/repo/${row.dataset.id}`);
});

document.getElementById('open').addEventListener('click', () => openDashboard('#/discover'));
document.getElementById('settings').addEventListener('click', () => openDashboard('#/settings'));

crawlBtn.addEventListener('click', async () => {
  crawlBtn.disabled = true;
  crawlBtn.textContent = '采集中…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'crawl:start' });
    if (!result?.ok) throw new Error(result?.error ?? '启动失败');
    setTimeout(() => void load(), 800);
  } catch (error) {
    statusEl.textContent = `启动失败：${error.message}`;
    crawlBtn.disabled = false;
    crawlBtn.textContent = '立即采集';
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'radar:changed') void load();
});

void load();
