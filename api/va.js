const VA_SERVER = 'http://13.246.211.152:8080';

module.exports = async function handler(req, res) {
  const path = req.url.replace('/api/va', '/api');
  const target = `${VA_SERVER}${path}`;

  const headers = { ...req.headers };
  delete headers['host'];
  delete headers['content-length']; // Let fetch recalculate

  try {
    const fetchOptions = { method: req.method, headers };

    // Read body as string for POST/PATCH/PUT
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      if (body) {
        fetchOptions.body = body;
        fetchOptions.headers['content-type'] = 'application/json';
      }
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
