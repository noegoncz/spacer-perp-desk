// perpyx.com/ref/<přezdívka> → úvodní stránka (nahoře) s přezdívkou v parametru.
// Web si přezdívku ověří (/api/ref), ukáže proužek „Pozval tě …" a pošle
// ji s přihláškou do bety. Přesměrování nic neukládá, žádné cookies.
export function onRequestGet({ params, request }) {
  const nick = String(params.nick || '').trim().toLowerCase().slice(0, 40);
  const cil = new URL('/', request.url);
  if (/^[a-z0-9-]{3,20}$/.test(nick)) cil.searchParams.set('ref', nick);
  // Bez #beta: stránka se otevře nahoře s proužkem „Pozval tě …", ne
  // odscrollovaná k formuláři (hlášeno uživatelem — proužek pak nebyl vidět).
  return Response.redirect(cil.toString(), 302);
}
