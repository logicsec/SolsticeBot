const base = 'https://www.wowhead.com/forever';
const known = new Map([
  ['reverence', base + '/item=254696'],
  ['holy conduit', base + '/spell=1237268'],
]);
const maxLinks = 5;

export function parseWowLinks(content) {
  const links = new Map();
  // Prefer native WoW hyperlinks, which retain the type and numeric ID.
  const native = /\|H(item|spell|enchant|talent|achievement|quest):(\d{1,10})(?::[^|\r\n]*)?\|h\[([^\[\]\r\n]{1,100})\]\|h/g;
  const remaining = content.replace(native, (_, type, id, name) => {
    const pathType = type === 'enchant' ? 'spell' : type;
    const key = name.trim().toLowerCase();
    if (key && Number(id) > 0) links.set(key, { name: name.trim(), url: base + '/' + pathType + '=' + id });
    return '';
  }).replace(/\[[^\[\]\r\n]*\]\(<?https?:\/\/[^\s)]+>?\)/gi, '');
  for (const [, label] of remaining.matchAll(/\[([^\[\]\r\n]{2,100})\]/g)) {
    const name = label.trim();
    const key = name.toLowerCase();
    if (!links.has(key) && /\p{L}/u.test(name) && !/[<>|]/.test(name)) links.set(key, { name });
  }
  return [...links.values()].slice(0, maxLinks);
}

export function exactWowheadResult(html, name) {
  const payload = /WH\.SearchPage\.showTopResults\((\[[^\r\n]*?\])\);/.exec(html)?.[1];
  if (!payload) return null;
  let results;
  try { results = JSON.parse(payload); } catch { return null; }
  const candidates = new Set();
  for (const result of results) {
    const label = result.lvjson?.displayName || result.lvjson?.name;
    if (typeof label !== 'string' || label.trim().toLowerCase() !== name.toLowerCase()) continue;
    const path = /^\/forever\/(item|spell|talent|achievement|quest)=(\d{1,10})(?:\/[^?#]*)?$/.exec(result.url);
    if (path && Number(path[2]) > 0) candidates.add(base + '/' + path[1] + '=' + path[2]);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

const cache = new Map();
export async function resolveWowLink(link) {
  if (link.url) return link;
  const key = link.name.toLowerCase();
  const search = base + '/search?q=' + encodeURIComponent(link.name);
  if (known.has(key)) return { ...link, url: known.get(key) };
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return { ...link, ...await previous.result };
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  const result = (async () => {
    try {
      const response = await fetch(search, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
      const location = response.headers.get('location');
      const redirected = location && new URL(location, base);
      const exactPath = redirected?.origin === 'https://www.wowhead.com' &&
        /^\/forever\/(item|spell|talent|achievement|quest)=\d{1,10}(?:\/[^?#]*)?$/.test(redirected.pathname);
      // A search redirect alone cannot establish that the result name matches.
      const candidate = exactPath ? await fetch(redirected, { redirect: 'error', signal: AbortSignal.timeout(6000) }) : null;
      if (candidate?.ok) {
        const title = /<meta property="og:title" content="([^"]+)"/.exec(await candidate.text())?.[1];
        if (title?.trim().toLowerCase() === key) return { url: redirected.origin + redirected.pathname };
      }
      if (response.ok) {
        const exact = exactWowheadResult(await response.text(), link.name);
        if (exact) return { url: exact };
      }
    } catch { /* The search link remains usable if Wowhead lookup is unavailable. */ }
    return { url: search, search: true };
  })();
  cache.set(key, { result, expires: Date.now() + 10 * 60_000 });
  return { ...link, ...await result };
}

const tooltipCache = new Map();
const qualityColors = [0x9d9d9d, 0xffffff, 0x1eff00, 0x0070dd, 0xa335ee, 0xff8000, 0xe6cc80];
const htmlEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function tooltipDescription(html, name) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>|<\/(?:div|tr|table|p)>/gi, '\n')
    .replace(/<span class="money(gold|silver|copper)">(\d+)<\/span>/gi, (_, coin, amount) => amount + coin[0])
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, key) => {
      if (!key.startsWith('#')) return htmlEntities[key] ?? match;
      const point = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    });
  const lines = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines[0]?.startsWith(name)) {
    lines[0] = lines[0].slice(name.length).trim();
    if (!lines[0]) lines.shift();
  }
  const description = lines.join('\n');
  return description.length > 700 ? description.slice(0, 697).trimEnd() + '…' : description;
}

export async function wowheadDetails(link) {
  const path = new URL(link).pathname;
  const match = /^\/forever\/(item|spell)=(\d{1,10})(?:\/|$)/.exec(path);
  if (!match) return null;
  const [, type, id] = match;
  const key = type + ':' + id;
  const cached = tooltipCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (tooltipCache.size >= 500) tooltipCache.delete(tooltipCache.keys().next().value);
  const promise = (async () => {
    try {
      const response = await fetch('https://nether.wowhead.com/forever/tooltip/' + type + '/' + id + '?dataEnv=16&locale=0',
        { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const data = await response.json();
      if (typeof data.name !== 'string' || typeof data.tooltip !== 'string') return null;
      return {
        name: data.name.slice(0, 100),
        description: tooltipDescription(data.tooltip, data.name),
        color: type === 'item' ? qualityColors[data.quality] : undefined,
        icon: /^[a-z0-9_]+$/i.test(data.icon ?? '') ? 'https://wow.zamimg.com/images/wow/icons/large/' + data.icon + '.jpg' : undefined,
      };
    } catch {
      return null;
    }
  })();
  tooltipCache.set(key, { promise, expires: Date.now() + 10 * 60_000 });
  return promise;
}
