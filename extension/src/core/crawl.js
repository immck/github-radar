import {
  dbBulkPut,
  dbClear,
  dbCount,
  dbGet,
  dbGetAll,
  dbPut,
  getMeta,
  setMeta,
  STORES,
} from './db.js';
import { createClient, RateLimitError } from './github.js';
import { upsertRepository, addSnapshot, recomputeMetrics } from './store.js';
import { getSettings } from './settings.js';

const SESSION_KEY = 'crawl:session';
const LAST_TASK_KEY = 'crawl:lastTask';
const LAST_RUN_KEY = 'crawl:lastRunAt';

const FOCUS_CATEGORIES = ['ai-video', 'ai-image', 'ai-coding', 'ai-agent', 'web3'];

function isoDate(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildQueries(settings, categoryKeywords) {
  const now = Date.now();
  const queries = [
    {
      id: 'new-week',
      label: '最近 7 天新项目',
      q: `created:>=${isoDate(now - 7 * 86_400_000)} stars:>=${settings.minStars}`,
    },
    {
      id: 'new-month',
      label: '最近 30 天潜力项目',
      q: `created:>=${isoDate(now - 30 * 86_400_000)} stars:>=${Math.max(50, settings.minStars * 10)}`,
    },
    {
      id: 'active',
      label: '近期活跃成熟项目',
      q: `pushed:>=${isoDate(now - 3 * 86_400_000)} stars:>=1000`,
    },
  ];

  for (const slug of FOCUS_CATEGORIES) {
    const keywords = categoryKeywords[slug];
    if (!keywords || keywords.length === 0) continue;
    queries.push({
      id: slug,
      label: `分类 · ${slug}`,
      q: `created:>=${isoDate(now - 30 * 86_400_000)} stars:>=10 ${keywords[0]}`,
    });
  }

  return queries.slice(0, 8);
}

export async function getSession() {
  return getMeta(SESSION_KEY);
}

export async function getLastTask() {
  return getMeta(LAST_TASK_KEY);
}

export async function getLastRunAt() {
  return getMeta(LAST_RUN_KEY);
}

export async function startCrawl({ trigger = 'manual', categoryKeywords = {} } = {}) {
  const existing = await getSession();
  if (existing) return existing;

  const settings = await getSettings();
  const session = {
    id: `crawl-${Date.now().toString(36)}`,
    startedAt: Date.now(),
    trigger,
    phase: 'search',
    queries: buildQueries(settings, categoryKeywords),
    queryIndex: 0,
    candidates: [],
    cursor: 0,
    touched: [],
    stats: { found: 0, saved: 0, updated: 0, skipped: 0, errors: 0 },
    warnings: [],
    authenticated: Boolean(settings.githubToken),
    maxDetail: settings.maxDetailPerCrawl,
  };

  await setMeta(SESSION_KEY, session);
  return session;
}

/**
 * 推进一小步（搜索 1 个 query 或同步 12 个仓库），保证在 Service Worker
 * 的 30 秒空闲回收之前结束。进度实时写入 IndexedDB，可中断续跑。
 */
export async function processCrawlStep({ maxDetails = 12 } = {}) {
  const session = await getSession();
  if (!session) return { done: true, session: null };

  const settings = await getSettings();
  const client = createClient(settings.githubToken);

  try {
    if (session.phase === 'search') {
      let ran = 0;
      while (session.queryIndex < session.queries.length && ran < 3) {
        const query = session.queries[session.queryIndex];
        try {
          const result = await client.search(query.q, { perPage: 50 });
          const seen = new Set(session.candidates.map((item) => item.fullName));
          for (const item of result.items ?? []) {
            if (!item?.full_name || seen.has(item.full_name)) continue;
            seen.add(item.full_name);
            session.candidates.push({ fullName: item.full_name, id: item.id, source: query.id });
          }
        } catch (error) {
          if (error instanceof RateLimitError) {
            session.warnings.push(error.message);
            session.pauseUntil = error.resetAt ?? Date.now() + 5 * 60_000;
            await setMeta(SESSION_KEY, session);
            return { done: false, paused: true, session, reason: 'rate-limit' };
          }
          session.warnings.push(`搜索失败（${query.label}）：${error.message}`);
        }
        session.queryIndex += 1;
        ran += 1;
        await sleep(500);
      }

      session.stats.found = session.candidates.length;
      if (session.queryIndex >= session.queries.length) session.phase = 'detail';
      await setMeta(SESSION_KEY, session);

      if (session.phase === 'search') {
        return { done: false, session, added: session.candidates.length };
      }
    }

    if (session.phase === 'detail') {
      const budgetLeft = Number(session.maxDetail ?? 120) - session.cursor;

      if (budgetLeft <= 0) {
        session.stats.skipped += Math.max(0, session.candidates.length - session.cursor);
        session.cursor = session.candidates.length;
        session.phase = 'metrics';
      } else {
        const slice = session.candidates.slice(session.cursor, session.cursor + Math.min(maxDetails, budgetLeft));

      for (const candidate of slice) {
        try {
          const existing = candidate.id ? await dbGet(STORES.repos, candidate.id) : null;

          // 同一轮采集内已经同步过就跳过
          if (existing?.lastFetchedAt && Date.now() - existing.lastFetchedAt < 5 * 60_000) {
            session.stats.skipped += 1;
            continue;
          }

          const result = await client.getRepo(candidate.fullName, existing?.etag ?? null);

          if (result.notModified && existing) {
            await dbPut(STORES.repos, { ...existing, lastFetchedAt: Date.now() });
            await addSnapshot({ ...existing, lastFetchedAt: Date.now() }, Date.now());
            session.touched.push(existing.id);
            session.stats.updated += 1;
          } else if (result.data) {
            const saved = await upsertRepository(result.data, {
              source: candidate.source === 'active' ? 'active' : 'search',
              etag: result.etag,
            });
            session.touched.push(saved.repo.id);
            if (saved.created) session.stats.saved += 1;
            else session.stats.updated += 1;
          }
        } catch (error) {
          if (error instanceof RateLimitError) {
            session.warnings.push(error.message);
            session.pauseUntil = error.resetAt ?? Date.now() + 5 * 60_000;
            await setMeta(SESSION_KEY, session);
            return { done: false, paused: true, session, reason: 'rate-limit' };
          }
          session.stats.errors += 1;
          if (session.warnings.length < 8) {
            session.warnings.push(`${candidate.fullName}: ${error.message}`);
          }
        }
        await sleep(140);
      }

        session.cursor += slice.length;
        await setMeta(SESSION_KEY, session);

        if (session.cursor >= session.candidates.length) {
          session.phase = 'metrics';
        } else {
          return { done: false, session };
        }
      }
    }

    if (session.phase === 'metrics') {
      await recomputeMetrics(session.touched, { fast24h: 100, hotStars: 10000, hot7d: 200 });
      await finishCrawl(session);
      return { done: true, session };
    }

    return { done: false, session };
  } catch (error) {
    session.warnings.push(error.message);
    await setMeta(SESSION_KEY, session);
    return { done: false, session, error: error.message };
  }
}

async function finishCrawl(session) {
  const task = {
    id: session.id,
    trigger: session.trigger,
    startedAt: session.startedAt,
    finishedAt: Date.now(),
    status: session.stats.errors > 0 ? 'partial' : 'success',
    found: session.candidates.length,
    saved: session.stats.saved,
    updated: session.stats.updated,
    skipped: session.stats.skipped,
    errors: session.stats.errors,
    warnings: session.warnings.slice(0, 10),
    authenticated: session.authenticated,
  };

  await setMeta(LAST_TASK_KEY, task);
  await setMeta(LAST_RUN_KEY, task.finishedAt);
  await setMeta(SESSION_KEY, null);

  await dbPut(STORES.tasks, task);
}

export async function getCounts() {
  const [repos, snapshots] = await Promise.all([
    dbCount(STORES.repos),
    dbCount(STORES.snapshots),
  ]);
  return { repos, snapshots };
}

export async function exportData() {
  const [repos, snapshots, favorites, analyses, tasks] = await Promise.all([
    dbGetAll(STORES.repos),
    dbGetAll(STORES.snapshots),
    dbGetAll(STORES.favorites),
    dbGetAll(STORES.analyses),
    dbGetAll(STORES.tasks),
  ]);
  return {
    app: 'github-radar',
    version: 1,
    exportedAt: new Date().toISOString(),
    repos,
    snapshots,
    favorites,
    analyses,
    tasks,
  };
}

export async function importData(payload) {
  if (!payload || payload.app !== 'github-radar' || !Array.isArray(payload.repos)) {
    throw new Error('不是有效的 GitHub Radar 导出文件');
  }
  await dbBulkPut(STORES.repos, payload.repos);
  await dbBulkPut(STORES.snapshots, payload.snapshots ?? []);
  await dbBulkPut(STORES.favorites, payload.favorites ?? []);
  await dbBulkPut(STORES.analyses, payload.analyses ?? []);
  await dbBulkPut(STORES.tasks, payload.tasks ?? []);
  return {
    repos: payload.repos.length,
    snapshots: (payload.snapshots ?? []).length,
  };
}

export async function clearAllData() {
  for (const store of [STORES.repos, STORES.snapshots, STORES.favorites, STORES.analyses, STORES.tasks]) {
    await dbClear(store);
  }
  await setMeta(SESSION_KEY, null);
  await setMeta(LAST_TASK_KEY, null);
  await setMeta(LAST_RUN_KEY, null);
}
