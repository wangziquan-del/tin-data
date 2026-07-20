import assert from 'node:assert/strict';
import { buildTechnicalPayload } from './src/technical.mjs';
import { buildSocialPayload } from './src/social.mjs';
import { buildPolicyPayload } from './src/policy.mjs';
import {
  handleIntelligenceRequest,
  runScheduledChecks,
} from './src/intelligence.mjs';

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

globalThis.caches = { default: new MemoryCache() };

function bars() {
  const base = Date.UTC(2025, 0, 1);
  return Array.from({ length: 320 }, function (_, index) {
    const close = 300000 + index * 300 + Math.sin(index / 4) * 1200;
    return {
      time: new Date(base + index * 86400000).toISOString().slice(0, 10),
      open: close - 300,
      high: close + 800,
      low: close - 900,
      close: close,
      volume: 1000 + index,
    };
  });
}

const rss = [
  '<rss><channel><item>',
  '<title>Federal Reserve issues FOMC monetary policy statement</title>',
  '<link>https://www.federalreserve.gov/example.htm</link>',
  '<pubDate>Sun, 19 Jul 2026 10:00:00 GMT</pubDate>',
  '<description>Monetary policy and inflation outlook</description>',
  '</item></channel></rss>',
].join('');

let failXhs = false;
let feishuCalls = 0;
globalThis.fetch = async function (input, init) {
  const url = String(input);
  if (url.indexOf('/guan/api/kline') >= 0) {
    return new Response(JSON.stringify({ bars: bars() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.indexOf('InnerFuturesNewService.getFewMinLine') >= 0) {
    const period = new URL(url).searchParams.get('type');
    const intraday = bars().map(function (bar, index) {
      return {
        d: bar.time + ' ' + String(9 + Math.floor(index / 4) % 6).padStart(2, '0') + ':' + String(index % 4 * Number(period)).padStart(2, '0') + ':00',
        o: String(bar.open),
        h: String(bar.high),
        l: String(bar.low),
        c: String(bar.close + Number(period)),
        v: String(bar.volume),
        p: String(1000 + index),
      };
    });
    return new Response('=(' + JSON.stringify(intraday) + ');', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript' },
    });
  }
  if (url.indexOf('/mcp/xhs-douyin') >= 0) {
    const body = JSON.parse(init.body);
    const tool = body.params.name;
    if (tool === 'xhs_search' && failXhs) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: 'error: test xhs failure' }],
          isError: true,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const payload = tool === 'xhs_search'
      ? {
        items: [{
          title: '沪锡库存去库，价格获得支撑',
          author: '小红书作者',
          liked_count: 30,
          comment_count: 6,
          create_time: 1784461335,
          note_id: 'xhs-1',
        }],
      }
      : {
        items: [{
          desc: '沪锡高位回调风险',
          author: '抖音作者',
          digg_count: 20,
          comment_count: 4,
          create_time: 1784461336,
          url: 'https://www.douyin.com/video/test',
        }],
      };
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.indexOf('federalreserve.gov/feeds/') >= 0) {
    return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
  }
  if (url.indexOf('internationaltin.org/feed') >= 0) {
    return new Response(rss
      .replace('Federal Reserve issues FOMC monetary policy statement', 'International Tin Association market update')
      .replace('https://www.federalreserve.gov/example.htm', 'https://www.internationaltin.org/example/'), {
      status: 200,
      headers: { 'Content-Type': 'application/rss+xml' },
    });
  }
  if (url.indexOf('alphaminresources.com/feed') >= 0) {
    return new Response(rss
      .replace('Federal Reserve issues FOMC monetary policy statement', 'Alphamin reports tin production update')
      .replace('https://www.federalreserve.gov/example.htm', 'https://www.alphaminresources.com/example/'), {
      status: 200,
      headers: { 'Content-Type': 'application/rss+xml' },
    });
  }
  if (url.indexOf('news.google.com/rss/search') >= 0) {
    return new Response(rss
      .replace('Federal Reserve issues FOMC monetary policy statement', 'Indonesia reviews tin export policy')
      .replace('https://www.federalreserve.gov/example.htm', 'https://example.com/indonesia-tin')
      .replace('</description>', '</description><source>Reuters</source>'), {
      status: 200,
      headers: { 'Content-Type': 'application/rss+xml' },
    });
  }
  if (url.indexOf('open.feishu.cn/') >= 0) {
    feishuCalls += 1;
    return new Response(JSON.stringify({ code: 0, msg: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error('Unexpected upstream: ' + url);
};

const technical = await buildTechnicalPayload({ ZHIJI_API_KEY: 'test-key' });
assert.equal(technical.tech.length, 3);
assert.equal(technical.kline.candles.length, 320);
assert.ok(technical.kline.mas.MA288.at(-1) > 0);

const social = await buildSocialPayload({ XHS_DOUYIN_MCP_TOKEN: 'test-token' });
assert.equal(social.items.length, 2);
assert.equal(social.sources['小红书'].ok, true);
assert.equal(social.sources['抖音'].ok, true);

const mockAi = {
  async run(model, input) {
    assert.equal(model, '@cf/zai-org/glm-4.7-flash');
    assert.equal(input.response_format.type, 'json_object');
    return {
      response: JSON.stringify({
        items: Array.from({ length: 12 }, function (_, id) {
          return {
            id: id,
            title_zh: '中文政策标题 ' + id,
            summary_zh: '这是严格根据 RSS 标题与摘要生成的中文内容，用于测试页面展示，同时保留原文链接供进一步核验。',
          };
        }),
      }),
    };
  },
};

const policy = await buildPolicyPayload({ AI: mockAi });
assert.ok(policy.items.length >= 2);
assert.equal(policy.items[0].official, true);
assert.ok(policy.items[0].title_zh.startsWith('中文政策标题'));
assert.ok(policy.items[0].summary_zh.includes('RSS'));
assert.equal(policy.sources['WORKERS AI 中文摘要'].ok, true);
assert.equal(Object.hasOwn(policy.items[0], '_source_text'), false);

const pending = [];
const response = await handleIntelligenceRequest(
  new Request('https://tin-insight-api.example/api/technical', {
    headers: { Origin: 'https://wangziquan-del.github.io' },
  }),
  { ZHIJI_API_KEY: 'test-key' },
  { waitUntil: function (promise) { pending.push(promise); } },
);
await Promise.all(pending);
assert.equal(response.status, 200);
assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://wangziquan-del.github.io');
assert.equal(response.headers.get('X-Tin-Cache'), 'MISS');

failXhs = true;
const monitor = await runScheduledChecks({
  ZHIJI_API_KEY: 'test-key',
  XHS_DOUYIN_MCP_TOKEN: 'test-token',
  FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
  AI: mockAi,
}, async function () {
  return { ok: true };
});
assert.equal(monitor.ok, false);
assert.equal(monitor.notified, true);
assert.equal(feishuCalls, 1);
assert.ok(monitor.issues.some(function (issue) {
  return issue.component.indexOf('小红书') >= 0;
}));

console.log('intelligence tests: ok');
