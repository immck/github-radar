import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis, buildPrompt, SCORE_DIMENSIONS } from '../src/core/ai.js';

const valid = {
  summaryZh: '一个把 README 变成产品的工具',
  problem: '缺少把开源项目转成产品的判断依据',
  targetUsers: ['独立开发者', '产品经理'],
  marketSignals: ['star 增长快'],
  monetization: ['订阅制'],
  competitors: [{ name: 'Foo', difference: '更轻量' }],
  maturity: '中等',
  devEffort: '低',
  reusable: ['CLI'],
  missing: ['计费'],
  infraCost: '无需 GPU',
  mvp: '先做周报',
  risks: ['需求不稳定'],
  score: 82,
  confidence: 0.7,
  scoreBreakdown: [
    { key: 'demand', score: 90, reason: 'star 增速' },
    { key: 'competition', score: 60, reason: '竞品少' },
    { key: 'unknown_key', score: 99, reason: 'should be dropped' },
  ],
  evidence: ['README 第 2 段'],
  unknowns: ['市场规模'],
};

test('合法结果被规范化并保留维度权重', () => {
  const analysis = normalizeAnalysis(valid);
  assert.equal(analysis.score, 82);
  assert.equal(analysis.confidence, 0.7);
  assert.equal(analysis.scoreBreakdown.length, 2);
  assert.equal(analysis.scoreBreakdown[0].weight, 25);
  assert.equal(analysis.estimated, true);
});

test('分数与置信度被限制在合法区间', () => {
  const analysis = normalizeAnalysis({ ...valid, score: 140, confidence: 3 });
  assert.equal(analysis.score, 100);
  assert.equal(analysis.confidence, 1);

  const low = normalizeAnalysis({ ...valid, score: -20, confidence: -1 });
  assert.equal(low.score, 0);
  assert.equal(low.confidence, 0);
});

test('非对象直接报错，避免把 HTML 错误页当分析结果', () => {
  assert.throws(() => normalizeAnalysis('<html>error</html>'), /JSON/);
  assert.throws(() => normalizeAnalysis(null), /JSON/);
});

test('缺失字段使用空数组/未知，而不是编造', () => {
  const analysis = normalizeAnalysis({ summaryZh: 'x' });
  assert.deepEqual(analysis.targetUsers, []);
  assert.deepEqual(analysis.competitors, []);
  assert.equal(analysis.problem, '未知');
  assert.equal(analysis.score, null);
  assert.equal(analysis.confidence, 0.3);
});

test('提示词包含项目事实、评分维度与“未知”约束', () => {
  const prompt = buildPrompt(
    {
      fullName: 'demo/alpha',
      description: 'text-to-image tool',
      language: 'Python',
      topics: ['diffusion'],
      stars: 1200,
      forks: 100,
      issues: 5,
      license: 'MIT',
      createdAtGithub: Date.UTC(2025, 0, 1),
      pushedAtGithub: Date.UTC(2026, 0, 1),
      homepage: '',
    },
    'README 内容',
  );

  assert.ok(prompt.includes('demo/alpha'));
  assert.ok(prompt.includes('README 内容'));
  assert.ok(prompt.includes('未知'));
  for (const dimension of SCORE_DIMENSIONS) {
    assert.ok(prompt.includes(dimension.label));
  }
});
