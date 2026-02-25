export const config = { runtime: 'edge' };

const VA_SERVER = 'http://13.246.211.152:8080';

export default async function handler(req) {
  // Strip /api/va prefix, forward the rest to the voice agent server
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/va', '');
  const target = `${VA_SERVER}${path}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    });

    const resHeaders = new Headers(response.headers);
    resHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Voice agent server unreachable', detail: e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
