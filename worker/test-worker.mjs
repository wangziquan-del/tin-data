import assert from 'node:assert/strict';
import worker from './src/index.mjs';

class MemoryCache {
  constructor() {
    this.rows = new Map();
  }

  async match(request) {
    const response = this.rows.get(request.url);
    return response ? response.clone() : undefined;
  }

  async put(request, response) {
    this.rows.set(request.url, response.clone());
  }
}

const quote = String.fromCharCode(34);
const sinaText = [
  'var hq_str_hf_SND=' + quote + '53385,0,0,0,0,0,09:45:00,53225,0,0,0,0,2026-07-20,LME锡' + quote + ';',
  'var hq_str_s_sh000852=' + quote + '中证1000,7200,10,0.14' + quote + ';',
].join('\n');

let upstreamCalls = 0;
globalThis.caches = { default: new MemoryCache() };
globalThis.fetch = async (input) => {
  const url = String(input);
  upstreamCalls += 1;
  if (url.startsWith('https://zhiji-ai.xyz/')) {
    return new Response(JSON.stringify({
      quotes: [
        { product: 'SN', symbol: 'sn2608', name: '沪锡', last: 414000, change_pct: 0.7, time: '09:45:01', open_interest: 34000, volume: 160000 },
        { product: 'AG', symbol: 'ag2610', name: '沪银', last: 13750, change_pct: 1.1, time: '09:45:01' },
        { product: 'CU', symbol: 'cu2609', name: '沪铜', last: 103900, change_pct: 0.3, time: '09:45:01' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.startsWith('https://hq.sinajs.cn/')) {
    return new Response(new TextEncoder().encode(sinaText), { status: 200 });
  }
  throw new Error('Unexpected upstream: ' + url);
};

async function call(path, init = {}) {
  const pending = [];
  const response = await worker.fetch(
    new Request('https://tin-insight-api.example' + path, init),
    { ZHIJI_API_KEY: 'test-secret' },
    { waitUntil: (promise) => pending.push(promise) },
  );
  await Promise.all(pending);
  return response;
}

const first = await call('/api/quotes', {
  headers: { Origin: 'https://wangziquan-del.github.io' },
});
assert.equal(first.status, 200);
assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://wangziquan-del.github.io');
assert.equal(first.headers.get('X-Tin-Cache'), 'MISS');
const firstPayload = await first.json();
assert.equal(firstPayload.sn.last, 414000);
assert.equal(firstPayload.lme.last, 53385);
assert.ok(firstPayload.ratios.tin_silver.value > 30);
assert.equal(upstreamCalls, 2);

const second = await call('/api/quotes', {
  headers: { Origin: 'https://wangziquan-del.github.io' },
});
assert.equal(second.headers.get('X-Tin-Cache'), 'HIT');
assert.equal(upstreamCalls, 2);

const health = await call('/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).configured, true);

const preflight = await call('/api/quotes', {
  method: 'OPTIONS',
  headers: { Origin: 'https://wangziquan-del.github.io' },
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://wangziquan-del.github.io');

console.log('worker tests: ok');
