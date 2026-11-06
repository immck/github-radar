import {
  dbCount,
  dbDelete,
  dbGet,
  dbGetAll,
  dbGetAllByIndex,
  dbPut,
  STORES,
} from './db.js';
import { classify } from './classify.js';
import { computeMetrics, computeTags } from './growth.js';

function parseDate(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function repoFromGitHub(raw) {
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner?.login ?? String(raw.full_name).split('/')[0] ?? '',
    name: raw.name,
    url: raw.html_url,
    description: raw.description ?? '',
    homepage: raw.homepage ?? '',
    language: raw.language ?? '',
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    watchers: raw.subscribers_count ?? raw.watchers_count ?? 0,
    issues: raw.open_issues_count ?? 0,
    license: raw.license?.spdx_id && raw.license.spdx_id !== 'NOASSERTION' ? raw.license.spdx_id : '',
    licenseName: raw.license?.name ?? '',
    createdAtGithub: parseDate(raw.created_at),
    updatedAtGithub: parseDate(raw.updated_at),
    pushedAtGithub: parseDate(raw.pushed_at),
    archived: Boolean(raw.archived || raw.disabled),
  };
}

export async function upsertRepository(raw, options = {}) {
  const { source = 'search', etag = null, capturedAt = Date.now() } = options;
  const doc = repoFromGitHub(raw);
  const existing = await dbGet(STORES.repos, doc.id);

  const discoveredVia = Array.isArray(existing?.discoveredVia) ? [...existing.discoveredVia] : [];
  if (!discoveredVia.includes(source)) discoveredVia.push(source);

  let category = existing?.category;
  let categoryName = existing?.categoryName;
  let categorySource = existing?.categorySource;
  let categoryConfidence = existing?.categoryConfidence ?? 0;

  if (!category || categorySource === 'rule') {
    const result = classify({ name: doc.name, description: doc.description, topics: doc.topics });
    category = result.slug;
    categoryName = result.name;
    categorySource = result.source;
    categoryConfidence = result.confidence;
  }

  const merged = {
    ...existing,
    ...doc,
    etag: etag ?? existing?.etag ?? null,
    discoveredVia,
    category,
    categoryName,
    categorySource,
    categoryConfidence,
    firstSeenAt: existing?.firstSeenAt ?? capturedAt,
    lastFetchedAt: capturedAt,
    tags: existing?.tags ?? [],
  };

  await dbPut(STORES.repos, merged);
  await addSnapshot(merged, capturedAt);
  return { repo: merged, created: !existing };
}

export async function addSnapshot(repo, capturedAt = Date.now()) {
  const key = `${repo.id}:${capturedAt}`;
  await dbPut(STORES.snapshots, {
    key,
    repoId: repo.id,
    stars: repo.stars,
    forks: repo.forks,
    watchers: repo.watchers,
    capturedAt,
  });
}

export async function getSnapshots(repoId, limit = 2000) {
  const rows = await dbGetAllByIndex(STORES.snapshots, 'repoId', repoId);
  rows.sort((a, b) => b.capturedAt - a.capturedAt);
  return rows.slice(0, limit);
}

export async function listRepositories() {
  return dbGetAll(STORES.repos);
}

export async function getRepository(id) {
  return dbGet(STORES.repos, id);
}

export async function recomputeMetrics(repoIds, thresholds) {
  const ids = Array.from(new Set(repoIds));
  let updated = 0;
  for (const id of ids) {
    const repo = await dbGet(STORES.repos, id);
    if (!repo) continue;
    const snapshots = await getSnapshots(id, 400);
    if (snapshots.length === 0) continue;

    const current = { stars: repo.stars, capturedAt: repo.lastFetchedAt ?? snapshots[0].capturedAt };
    const metrics = computeMetrics(current, snapshots);
    const tags = computeTags(
      {
        stars: repo.stars,
        createdAtGithub: repo.createdAtGithub,
        stars24h: metrics['24h'].delta,
        stars7d: metrics['7d'].delta,
        stars30d: metrics['30d'].delta,
        recentStars: snapshots.slice(0, 4).map((row) => row.stars),
      },
      thresholds,
    );

    await dbPut(STORES.repos, {
      ...repo,
      stars24h: metrics['24h'].delta,
      stars7d: metrics['7d'].delta,
      stars30d: metrics['30d'].delta,
      rate24h: metrics['24h'].rate,
      rate7d: metrics['7d'].rate,
      rate30d: metrics['30d'].rate,
      basis24hAt: metrics['24h'].basisAt,
      window24hHours: metrics['24h'].windowHours,
      basis7dAt: metrics['7d'].basisAt,
      window7dHours: metrics['7d'].windowHours,
      tags,
      metricsUpdatedAt: Date.now(),
    });
    updated += 1;
  }
  return updated;
}

export async function getFavorites() {
  const rows = await dbGetAll(STORES.favorites);
  return new Set(rows.map((row) => row.repoId));
}

export async function toggleFavorite(repoId, note = '') {
  const existing = await dbGet(STORES.favorites, repoId);
  if (existing) {
    await dbDelete(STORES.favorites, repoId);
    return false;
  }
  await dbPut(STORES.favorites, { repoId, note, createdAt: Date.now() });
  return true;
}

export async function deleteRepository(id) {
  const snapshots = await getSnapshots(id);
  for (const snapshot of snapshots) {
    await dbDelete(STORES.snapshots, snapshot.key);
  }
  await dbDelete(STORES.favorites, id);
  await dbDelete(STORES.repos, id);
}

export async function countAll() {
  const [repos, snapshots] = await Promise.all([
    dbCount(STORES.repos),
    dbCount(STORES.snapshots),
  ]);
  return { repos, snapshots };
}
