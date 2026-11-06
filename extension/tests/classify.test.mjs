import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/core/classify.js';

test('图像生成项目归到 AI 图片', () => {
  const result = classify({
    name: 'stable-diffusion-webui',
    description: 'A web interface for Stable Diffusion image generation',
    topics: ['stable-diffusion', 'text-to-image'],
  });
  assert.equal(result.slug, 'ai-image');
  assert.ok(result.confidence > 0.5);
});

test('Solana 项目归到 Solana 而不是 Web3', () => {
  const result = classify({
    name: 'anchor',
    description: 'Solana Sealevel framework for Solana programs',
    topics: ['solana', 'anchor'],
  });
  assert.equal(result.slug, 'solana');
});

test('没有任何关键词时落到其他，不瞎猜', () => {
  const result = classify({ name: 'dotfiles', description: 'my personal dotfiles', topics: [] });
  assert.equal(result.slug, 'other');
  assert.equal(result.confidence, 0);
});

test('名称命中权重高于描述命中', () => {
  const result = classify({
    name: 'ai-video-editor',
    description: 'mentions database and sql casually',
    topics: [],
  });
  assert.equal(result.slug, 'ai-video');
});

test('置信度不会超过 0.95', () => {
  const result = classify({
    name: 'text-to-image image-generation stable-diffusion',
    description: 'text-to-image diffusion image generation',
    topics: ['stable-diffusion', 'comfyui'],
  });
  assert.ok(result.confidence <= 0.95);
});
