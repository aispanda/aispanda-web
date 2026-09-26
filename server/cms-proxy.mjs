import { GoogleAuth } from 'google-auth-library';

const hopByHopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

export const isCmsPath = (pathname) => pathname === '/cms' || pathname.startsWith('/cms/');

export const createCmsProxy = ({
  targetOrigin,
  audience = targetOrigin,
  publicOrigin,
  fetchImpl = fetch,
  identityToken,
} = {}) => {
  const target = new URL(targetOrigin);
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('CMS_PROXY_TARGET must be an HTTPS origin.');
  }
  const canonicalOrigin = publicOrigin ? new URL(publicOrigin).origin : null;

  let tokenClientPromise;
  const resolveIdentityToken = identityToken ?? (async () => {
    tokenClientPromise ??= new GoogleAuth().getIdTokenClient(audience);
    const client = await tokenClientPromise;
    const headers = await client.getRequestHeaders(target.origin);
    const authorization = headers.get?.('authorization') ?? headers.Authorization ?? headers.authorization;
    if (!authorization) throw new Error('CMS identity token unavailable.');
    return authorization;
  });

  return async (request) => {
    const incoming = new URL(request.url);
    if (!isCmsPath(incoming.pathname)) return new Response('Not found', { status: 404 });
    if (canonicalOrigin && incoming.origin !== canonicalOrigin) return new Response('Not found', { status: 404 });

    const upstreamURL = new URL(incoming.pathname + incoming.search, target);
    const headers = new Headers();
    request.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (!hopByHopHeaders.has(lower) && lower !== 'host' && lower !== 'content-length' && lower !== 'x-serverless-authorization') {
        headers.set(name, value);
      }
    });
    headers.set('X-Serverless-Authorization', await resolveIdentityToken());
    headers.set('X-Forwarded-Host', incoming.host);
    headers.set('X-Forwarded-Proto', incoming.protocol.slice(0, -1));

    const response = await fetchImpl(upstreamURL, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: request.body ? 'half' : undefined,
      redirect: 'manual',
    });
    const responseHeaders = new Headers(response.headers);
    for (const name of hopByHopHeaders) responseHeaders.delete(name);
    const location = responseHeaders.get('location');
    if (location) {
      const resolved = new URL(location, target);
      if (resolved.origin === target.origin) responseHeaders.set('location', incoming.origin + resolved.pathname + resolved.search + resolved.hash);
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  };
};
