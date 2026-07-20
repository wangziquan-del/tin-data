import {
  fetchWithTimeout,
  safeError,
  shanghaiTimestamp,
} from './intelligence-shared.mjs';

const POLICY_FEEDS = [
  {
    name: 'FEDERAL RESERVE PRESS RSS',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    source: 'FEDERAL RESERVE',
    category: 'MACRO · FED',
    filter: /monetary|federal funds|interest rate|inflation|economic|industrial production|fomc/i,
  },
  {
    name: 'FEDERAL RESERVE SPEECH RSS',
    url: 'https://www.federalreserve.gov/feeds/speeches_and_testimony.xml',
    source: 'FEDERAL RESERVE',
    category: 'MACRO · FED',
    filter: /monetary|interest rate|inflation|economic|economy|outlook|fomc/i,
  },
  {
    name: 'INTERNATIONAL TIN ASSOCIATION RSS',
    url: 'https://www.internationaltin.org/feed/',
    source: 'INTERNATIONAL TIN ASSOCIATION',
    category: 'TIN INDUSTRY',
    filter: null,
  },
  {
    name: 'ALPHAMIN RSS',
    url: 'https://www.alphaminresources.com/feed/',
    source: 'ALPHAMIN RESOURCES',
    category: 'TIN SUPPLY · DRC',
    filter: null,
  },
  {
    name: 'GOOGLE NEWS TIN RSS',
    url: 'https://news.google.com/rss/search?q=%28%22tin%20mining%22%20OR%20%22tin%20production%22%20OR%20%22tin%20export%22%20OR%20%22Myanmar%20tin%22%20OR%20%22Indonesia%20tin%22%20OR%20%22tin%20solder%22%29%20when%3A7d&hl=en-US&gl=US&ceid=US%3Aen',
    source: 'GOOGLE NEWS · TIN',
    category: 'TIN INDUSTRY',
    filter: null,
    itemSource: true,
    dynamicCategory: true,
    official: false,
    optional: true,
  },
];

function decodeXml(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, String.fromCharCode(34))
    .replace(/&#39;|&apos;/g, String.fromCharCode(39))
    .replace(/&#(\d+);/g, function (_, code) {
      return String.fromCharCode(Number(code));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, code) {
      return String.fromCharCode(parseInt(code, 16));
    })
    .replace(/<[^>]+>/g, '')
    .trim();
}

function xmlField(block, field) {
  const pattern = new RegExp('<(?:[A-Za-z0-9_-]+:)?' + field + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?' + field + '>', 'i');
  const match = String(block).match(pattern);
  return match ? decodeXml(match[1]) : '';
}

function atomLink(block) {
  const quote = String.fromCharCode(34);
  const pattern = new RegExp('<link[^>]+href=' + quote + '([^' + quote + ']+)' + quote + '[^>]*>', 'i');
  const match = String(block).match(pattern);
  return match ? decodeXml(match[1]) : '';
}

function policyCategory(title, domain) {
  const text = (title + ' ' + domain).toLowerCase();
  if (/myanmar|wa state|man maw/.test(text)) return 'TIN SUPPLY · MYANMAR';
  if (/indonesia|pt timah|bangka|riau/.test(text)) return 'TIN SUPPLY · INDONESIA';
  if (/alphamin|bisie|congo|drc/.test(text)) return 'TIN SUPPLY · DRC';
  if (/fed|fomc|interest rate|inflation|cpi|tariff/.test(text)) return 'MACRO · POLICY';
  if (/semiconductor|solder|pcb|tsmc|artificial intelligence|battery/.test(text)) return 'AI / ELECTRONICS';
  return 'TIN INDUSTRY';
}

function normalizedDate(value) {
  const text = String(value || '').trim();
  if (/^\d{8}T\d{6}Z$/.test(text)) {
    return text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : shanghaiTimestamp().slice(0, 10);
}

async function fetchRssFeed(definition) {
  const response = await fetchWithTimeout(definition.url, {
    headers: {
      Accept: 'application/rss+xml, application/atom+xml, text/xml',
      'User-Agent': 'Tin Insight Policy Monitor/1.0',
    },
  }, 25000);
  if (!response.ok) throw new Error(definition.source + ' RSS HTTP ' + response.status);
  const xml = await response.text();
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 20).map(function (block) {
    const title = xmlField(block, 'title');
    const context = title + ' ' + xmlField(block, 'description') + ' ' + xmlField(block, 'summary');
    if (!title || definition.filter && !definition.filter.test(context)) return null;
    const source = definition.itemSource ? xmlField(block, 'source') || definition.source : definition.source;
    return {
      title: title,
      url: xmlField(block, 'link') || atomLink(block),
      date: normalizedDate(xmlField(block, 'pubDate') || xmlField(block, 'published') || xmlField(block, 'updated')),
      source: source,
      category: definition.dynamicCategory ? policyCategory(title, source) : definition.category,
      official: definition.official !== false,
    };
  }).filter(Boolean);
}

function dedupePolicy(items) {
  const seen = new Set();
  return items.filter(function (item) {
    const key = item.title.replace(/\s+/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildPolicyPayload() {
  const definitions = POLICY_FEEDS.map(function (feed) {
    return { name: feed.name, optional: Boolean(feed.optional), promise: fetchRssFeed(feed) };
  });
  const settled = await Promise.allSettled(definitions.map(function (definition) {
    return definition.promise;
  }));
  let items = [];
  const sources = {};
  settled.forEach(function (result, index) {
    const name = definitions[index].name;
    if (result.status === 'fulfilled') {
      sources[name] = { ok: true, count: result.value.length, optional: definitions[index].optional };
      items = items.concat(result.value);
    } else {
      sources[name] = {
        ok: false,
        count: 0,
        error: safeError(result.reason),
        optional: definitions[index].optional,
      };
    }
  });
  items = dedupePolicy(items);
  items.sort(function (left, right) {
    return Number(right.official) - Number(left.official) || right.date.localeCompare(left.date);
  });
  if (!items.length) throw new Error('All policy and event sources failed');
  return {
    updated_at: shanghaiTimestamp(),
    source: '官方 RSS + Google News 锡产业聚合；15 分钟边缘缓存',
    method: '仅展示标题、来源与原文链接，不自动编造摘要',
    sources: sources,
    items: items.slice(0, 12),
  };
}
