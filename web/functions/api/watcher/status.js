// Stav hlídače (kdy se naposledy ozval a co hlásí: stream, počet alarmů,
// poslední výsledek u Firebase). Jen s WATCHER_TOKEN — pro testy
// a budoucí přehled provozovatele; na server se nikdo nepřihlašuje.
export async function onRequestGet({ env }) {
  const s = await env.DB.prepare('SELECT seen_at, info FROM watcher_status WHERE id = 1').first();
  return Response.json({ ok: true, seenAt: s?.seen_at || null, info: s?.info || '' });
}
