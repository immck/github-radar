import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueries } from '../src/core/crawl.js';

const settings = { minStars: 5 };

test('查询计划包含时间窗口与 star 下限', () => {
  const queries = buildQueries(settings, {});
  assert.ok(queries.length >= 3);
  assert.ok(queries[0].q.includes('created:>='));
  assert.ok(queries[0].q.includes('stars:>=5'));
  assert.ok(queries.every((query) => query.q && query.label && query.id));
});

test('关注分类会追加关键词查询，且总数不超过 8', () => {
  const queries = buildQueries(settings, {
    'ai-video': ['text-to-video'],
    'ai-image': ['stable diffusion'],
    'ai-agent': ['agent framework'],
    'web3': ['ethereum'],
    'ai-coding': ['coding agent'],
    'unknown': ['should-be-ignored'],
  });
  assert.ok(queries.length <= 8);
  assert.ok(queries.some((query) => query.q.includes('text-to-video')));
  assert.ok(queries.some((query) => query.q.includes('stable diffusion')));
  assert.ok(!queries.some((query) => query.q.includes('should-be-ignored')));
});

test('查询 id 唯一，便于断点续跑', () => {
  const queries = buildQueries(settings, { 'ai-video': ['text-to-video'], 'ai-image': ['diffusion'] });
  const ids = queries.map((query) => query.id);
  assert.equal(new Set(ids).size, ids.length);
});
