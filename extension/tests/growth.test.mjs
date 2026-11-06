import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBasis,
  computeGrowth,
  computeWindowMetric,
  computeMetrics,
  computeTags,
} from '../src/core/growth.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 7, 0, 0, 0);

test('24h 增长只取不晚于目标时间的最近快照', () => {
  const current = { stars: 1100, capturedAt: NOW };
  const snapshots = [
    current,
    { stars: 1000, capturedAt: NOW - 24 * HOUR },
    { stars: 900, capturedAt: NOW - 7 * 24 * HOUR },
  ];

  const metric = computeWindowMetric(current, snapshots, { hours: 24, toleranceHours: 12 });
  assert.equal(metric.delta, 100);
  assert.equal(metric.rate, 10);
  assert.equal(metric.windowHours, 24);
});

test('快照间隔超出容差时返回数据不足，而不是用总量推算', () => {
  const current = { stars: 500, capturedAt: NOW };
  const snapshots = [current, { stars: 400, capturedAt: NOW - 40 * HOUR }];

  const metric = computeWindowMetric(current, snapshots, { hours: 24, toleranceHours: 12 });
  assert.equal(metric.delta, null);
  assert.equal(metric.basisAt, null);
});

test('只有一条快照时所有窗口都是 null', () => {
  const current = { stars: 10, capturedAt: NOW };
  const metrics = computeMetrics(current, [current]);
  for (const key of ['24h', '7d', '30d']) {
    assert.equal(metrics[key].delta, null);
  }
});

test('取最近且不晚于目标的快照，而不是最早的一条', () => {
  const target = NOW - 24 * HOUR;
  const snapshots = [
    { stars: 3, capturedAt: NOW - 2 * HOUR },
    { stars: 2, capturedAt: NOW - 25 * HOUR },
    { stars: 1, capturedAt: NOW - 48 * HOUR },
  ];
  const basis = selectBasis(snapshots, target, 12);
  assert.equal(basis.stars, 2);
});

test('增长率在基准为 0 时为 null，负增长保留符号', () => {
  assert.equal(computeGrowth({ stars: 5, capturedAt: NOW }, { stars: 0, capturedAt: NOW - HOUR }).rate, null);
  const negative = computeGrowth({ stars: 80, capturedAt: NOW }, { stars: 100, capturedAt: NOW - 24 * HOUR });
  assert.equal(negative.delta, -20);
  assert.equal(negative.rate, -20);
});

test('标签：新项目 + 快速增长 + 高热度', () => {
  const tags = computeTags(
    {
      stars: 12000,
      createdAtGithub: NOW - 10 * 24 * HOUR,
      stars24h: 150,
      stars7d: 400,
      stars30d: 900,
      recentStars: [12000, 11900, 11800, 11700],
      now: NOW,
    },
    { fast24h: 100, hotStars: 10000, hot7d: 200 },
  );
  assert.ok(tags.includes('new'));
  assert.ok(tags.includes('fast'));
  assert.ok(tags.includes('hot'));
  assert.ok(tags.includes('sustained'));
});

test('标签：没有增长数据时不产生增长类标签', () => {
  const tags = computeTags(
    {
      stars: 300,
      createdAtGithub: NOW - 5 * 24 * HOUR,
      stars24h: null,
      stars7d: null,
      stars30d: null,
      recentStars: [300],
      now: NOW,
    },
    { fast24h: 100, hotStars: 10000, hot7d: 200 },
  );
  assert.deepEqual(tags, ['new']);
});
