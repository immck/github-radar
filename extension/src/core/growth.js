/** 增长计算：只用真实快照差值，缺数据返回 null，绝不用总量推算。 */

export const WINDOWS = [
  { key: '24h', hours: 24, toleranceHours: 12 },
  { key: '7d', hours: 168, toleranceHours: 24 },
  { key: '30d', hours: 720, toleranceHours: 72 },
];

/**
 * @param {Array<{stars:number,capturedAt:number}>} snapshotsDesc 按时间降序
 * @param {number} targetMs
 * @param {number} toleranceHours
 */
export function selectBasis(snapshotsDesc, targetMs, toleranceHours) {
  for (const snapshot of snapshotsDesc) {
    if (snapshot.capturedAt <= targetMs) {
      const gapHours = (targetMs - snapshot.capturedAt) / 3_600_000;
      return gapHours <= toleranceHours ? snapshot : null;
    }
  }
  return null;
}

export function computeGrowth(current, basis) {
  const delta = current.stars - basis.stars;
  const windowHours = (current.capturedAt - basis.capturedAt) / 3_600_000;
  const rate = basis.stars > 0 ? (delta / basis.stars) * 100 : null;
  return { delta, rate, windowHours, basisAt: basis.capturedAt };
}

export function computeWindowMetric(current, snapshotsDesc, window) {
  const target = current.capturedAt - window.hours * 3_600_000;
  const basis = selectBasis(snapshotsDesc, target, window.toleranceHours);
  if (!basis) return { delta: null, rate: null, basisAt: null, windowHours: null };
  const growth = computeGrowth(current, basis);
  return {
    delta: growth.delta,
    rate: growth.rate,
    basisAt: growth.basisAt,
    windowHours: growth.windowHours,
  };
}

export function computeMetrics(current, snapshotsDesc) {
  const result = {};
  for (const window of WINDOWS) {
    result[window.key] = computeWindowMetric(current, snapshotsDesc, window);
  }
  return result;
}

const TAG_LABELS = {
  new: '新项目',
  fast: '快速增长',
  sustained: '持续增长',
  hot: '高热度',
  slowing: '增长放缓',
  long_term: '长期热门',
};

export function tagLabel(tag) {
  return TAG_LABELS[tag] ?? tag;
}

export function computeTags(input, thresholds = { fast24h: 100, hotStars: 10000, hot7d: 200 }) {
  const tags = [];
  const now = input.now ?? Date.now();

  if (input.createdAtGithub) {
    const ageDays = (now - input.createdAtGithub) / 86_400_000;
    if (ageDays >= 0 && ageDays <= 30) tags.push('new');
  }
  if (input.stars24h !== null && input.stars24h >= thresholds.fast24h) tags.push('fast');

  const recent = input.recentStars ?? [];
  if (recent.length >= 4) {
    const [a, b, c, d] = recent;
    if (a > b && b > c && c > d) tags.push('sustained');
  }
  if (input.stars >= thresholds.hotStars && (input.stars7d ?? 0) >= thresholds.hot7d) {
    tags.push('hot');
  }
  if (
    input.stars24h !== null &&
    input.stars7d !== null &&
    input.stars7d > 0 &&
    input.stars24h < 0.3 * (input.stars7d / 7)
  ) {
    tags.push('slowing');
  }
  if (input.createdAtGithub) {
    const ageDays = (now - input.createdAtGithub) / 86_400_000;
    if (ageDays > 365 && input.stars >= 5000 && (input.stars30d ?? 0) > 0) tags.push('long_term');
  }

  return tags;
}
