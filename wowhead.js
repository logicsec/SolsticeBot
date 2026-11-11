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
