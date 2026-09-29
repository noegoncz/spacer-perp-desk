// Rozhraní pro serverového hlídače alarmů (server/hlidac.mjs).
// Jen s tajným tokenem WATCHER_TOKEN — hlídač je jediný, kdo ho má.
// Porovnání v konstantním čase, ať nejde token hádat po znacích.

function stejne(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let rozdil = 0;
  for (let i = 0; i < a.length; i += 1) rozdil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdil === 0;
}

export async function onRequest({ request, env, next }) {
  const t = request.headers.get('X-Watcher-Token') || '';
  if (!env.WATCHER_TOKEN || !stejne(t, env.WATCHER_TOKEN)) {
    return new Response('{"ok":false}', { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return next();
}
