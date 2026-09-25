const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function parseProxyLine(text) {
  if (!text) return null;
  text = text.trim().replace(/\s+/g, '');

  if (text.includes('@')) {
    const atParts = text.split('@');
    const auth = atParts[0].split(':');
    const hp = atParts[1].split(':');
    if (auth.length === 2 && hp.length === 2 && !isNaN(hp[1])) {
      return { host: hp[0], port: parseInt(hp[1]), user: auth[0], pass: auth[1], raw: text };
    }
  }

  let parts = text.split(',').length > 1 ? text.split(',') : text.split(':');

  if (parts.length === 4 && !isNaN(parts[1])) {
    return { host: parts[0], port: parseInt(parts[1]), user: parts[2], pass: parts[3], raw: text };
  } else if (parts.length === 4 && !isNaN(parts[3])) {
    return { host: parts[2], port: parseInt(parts[3]), user: parts[0], pass: parts[1], raw: text };
  } else if (parts.length === 2 && !isNaN(parts[1])) {
    return { host: parts[0], port: parseInt(parts[1]), user: '', pass: '', raw: text };
  }
  
  return null;
}

async function checkSingleProxy(px) {
  let proxyUrl = px.user 
    ? `http://${px.user}:${px.pass}@${px.host}:${px.port}`
    : `http://${px.host}:${px.port}`;

  const agent = new HttpsProxyAgent(proxyUrl);

  try {
    const response = await axios.get('https://api.ipify.org?format=json', {
      httpsAgent: agent,
      timeout: 2500 // ২.৫ সেকেন্ড টাইমআউট
    });

    if (response.status === 200) {
      return { status: 'valid', raw: px.raw, ip: response.data.ip || 'Unknown' };
    }
    return { status: 'invalid', raw: px.raw, error: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'invalid', raw: px.raw, error: 'Failed' };
  }
}

app.post('/check-proxies', async (req, res) => {
  try {
    const { proxies } = req.body;
    if (!proxies || !Array.isArray(proxies) || proxies.length === 0) {
      return res.status(400).json({ success: false, message: 'প্রক্সি খালি' });
    }

    const parsedProxies = proxies.map(p => parseProxyLine(p)).filter(p => p !== null);
    if (parsedProxies.length === 0) {
      return res.status(400).json({ success: false, message: 'সঠিক প্রক্সি পাওয়া যায়নি' });
    }

    // ৫টি করে ছোট চ্যাঙ্কে ভাগ করে প্রসেস করা (Render ক্র্যাশ ঠেকাতে)
    const results = [];
    const chunkSize = 5;
    
    for (let i = 0; i < parsedProxies.length; i += chunkSize) {
      const chunk = parsedProxies.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(px => checkSingleProxy(px)));
      results.push(...chunkResults);
    }

    const validProxies = results.filter(r => r.status === 'valid');
    const invalidProxies = results.filter(r => r.status === 'invalid');

    res.json({
      success: true,
      summary: { total: results.length, valid: validProxies.length, invalid: invalidProxies.length },
      valid: validProxies.map(p => ({ proxy: p.raw, ip: p.ip })),
      invalid: invalidProxies.map(p => ({ proxy: p.raw, error: p.error }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'সার্ভার এরর: ' + error.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`🚀 Proxy Checker API Live on Port ${PORT}`));
