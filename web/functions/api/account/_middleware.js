// Předběžné dotazy CORS (OPTIONS) pro celé /api/account/*.
import { corsHlavicky } from '../../../lib/ucet.js';

export async function onRequest({ request, next }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHlavicky(request) });
  }
  return next();
}
