const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function parseProxyLine(text) {
  text = text.trim().replace(/\s+/g, '');
  let parts = text.split(',').length > 1 ? text.split(',') : text.split(':');
  
  if (parts.length === 4 && !isNaN(parts[1])) {
    return { host: parts[0], port: parseInt(parts[1]), user: parts[2], pass: parts[3], raw: text };
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
      timeout: 7000
    });

    if (response.status === 200) {
      return { status: 'valid', raw: px.raw, ip: response.data.ip || 'Unknown' };
    }
    return { status: 'invalid', raw: px.raw, error: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'invalid', raw: px.raw, error: 'Connection Failed/Timeout' };
  }
}

// ব্যাচ অনুযায়ী প্রক্সি প্রসেসিং (p-limit এর বিকল্প)
async function processInBatches(items, batchSize, fn) {
  let results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(item => fn(item)));
    results = results.concat(batchResults);
  }
  return results;
}

app.post('/check-proxies', async (req, res) => {
  try {
    const { proxies } = req.body;
    if (!proxies || !Array.isArray(proxies) || proxies.length === 0) {
      return res.status(400).json({ success: false, message: 'প্রক্সি লিস্ট খালি' });
    }

    const parsedProxies = proxies.map(p => parseProxyLine(p)).filter(p => p !== null);
    if (parsedProxies.length === 0) {
      return res.status(400).json({ success: false, message: 'কোন সঠিক প্রক্সি পাওয়া যায়নি' });
    }

    // একসাথে ১৫টি করে ব্যাচে প্রসেস করবে
    const results = await processInBatches(parsedProxies, 15, checkSingleProxy);

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
