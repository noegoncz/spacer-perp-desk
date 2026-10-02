// Veřejné ověření přezdívky z odkazu perpyx.com/ref/<přezdívka>: web podle
// toho ukáže proužek „Pozval tě …". Prozradí jen, jestli přezdívka existuje.
import { odpoved } from '../../lib/spolecne.js';
import { normalizuj, zvouciPodlePrezdivky } from '../../lib/ref.js';

export async function onRequestGet({ request, env }) {
  const nick = normalizuj(new URL(request.url).searchParams.get('nick'));
  const zvouci = await zvouciPodlePrezdivky(env, nick);
  return odpoved({ ok: true, exists: Boolean(zvouci), nick: zvouci ? zvouci.ref_nick : null });
}
