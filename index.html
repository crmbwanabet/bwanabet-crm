const VA_SERVER = 'http://13.246.211.152:8080';

module.exports = async function handler(req, res) {
  // /api/va/scripts → /api/scripts
  // /api/va/voice/status → /api/voice/status
  const path = req.url.replace('/api/va', '/api');
  const target = `${VA_SERVER}${path}`;

  const headers = { ...req.headers };
  delete headers['host'];

  try {
    const fetchOptions = { method: req.method, headers };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      fetchOptions.body = Buffer.concat(chunks);
    }

    const response = await fetch(target, fetchOptions);
    const data = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.status(response.status).send(data);

  } catch (e) {
    res.status(502).json({ error: 'Voice agent server unreachable', detail: e.message });
  }
}
