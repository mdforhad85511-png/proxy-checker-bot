const express = require('express');
const axios = require('axios');
const pLimit = require('p-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function parseProxyLine(text) {
  text = text.trim().replace(/\s+/g, '');
  let parts = text.split(',').length > 1 ? text.split(',') : text.split(':');
  
  if (parts.length === 4 && !isNaN(parts[1])) {
    return {
      host: parts[0],
      port: parseInt(parts[1]),
      user: parts[2],
      pass: parts[3],
      raw: text
    };
  } else if (parts.length === 2 && !isNaN(parts[1])) {
    return {
      host: parts[0],
      port: parseInt(parts[1]),
      user: '',
      pass: '',
      raw: text
    };
  }
  return null;
}

async function checkSingleProxy(px) {
  let proxyUrl;
  
  if (px.user) {
    proxyUrl = `http://${px.user}:${px.pass}@${px.host}:${px.port}`;
  } else {
    proxyUrl = `http://${px.host}:${px.port}`;
  }

  const httpsAgent = new (require('https').Agent)({ 
    rejectUnauthorized: false 
  });
  const httpAgent = new (require('http').Agent)();

  try {
    const response = await axios.get('https://api.ipify.org?format=json', {
      httpAgent: httpAgent,
      httpsAgent: httpsAgent,
      proxy: {
        protocol: 'http',
        host: px.host,
        port: px.port,
        auth: px.user ? {
          username: px.user,
          password: px.pass
        } : undefined
      },
      timeout: 7000
    });

    if (response.status === 200) {
      const ip = response.data.ip || 'Unknown';
      return {
        status: 'valid',
        raw: px.raw,
        ip: ip
      };
    }
    return {
      status: 'invalid',
      raw: px.raw,
      error: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      status: 'invalid',
      raw: px.raw,
      error: error.message.slice(0, 25)
    };
  }
}

app.post('/check-proxies', async (req, res) => {
  try {
    const { proxies } = req.body;

    if (!proxies || !Array.isArray(proxies) || proxies.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'প্রক্সি লিস্ট খালি'
      });
    }

    const parsedProxies = proxies
      .map(p => parseProxyLine(p))
      .filter(p => p !== null);

    if (parsedProxies.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'কোন সঠিক প্রক্সি পাওয়া যায়নি'
      });
    }

    const limit = pLimit(15);
    const checkPromises = parsedProxies.map(px => 
      limit(() => checkSingleProxy(px))
    );

    const results = await Promise.all(checkPromises);

    const validProxies = results.filter(r => r.status === 'valid');
    const invalidProxies = results.filter(r => r.status === 'invalid');

    res.json({
      success: true,
      summary: {
        total: results.length,
        valid: validProxies.length,
        invalid: invalidProxies.length
      },
      valid: validProxies.map(p => ({
        proxy: p.raw,
        ip: p.ip
      })),
      invalid: invalidProxies.map(p => ({
        proxy: p.raw,
        error: p.error
      }))
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'সার্ভার এরর: ' + error.message
    });
  }
});

app.post('/check-single', async (req, res) => {
  try {
    const { proxy } = req.body;

    if (!proxy) {
      return res.status(400).json({
        success: false,
        message: 'প্রক্সি প্রয়োজন'
      });
    }

    const parsed = parseProxyLine(proxy);
    if (!parsed) {
      return res.status(400).json({
        success: false,
        message: 'ভুল প্রক্সি ফরম্যাট'
      });
    }

    const result = await checkSingleProxy(parsed);
    res.json({
      success: result.status === 'valid',
      result: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'Proxy Checker Server Running',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 প্রক্সি চেকার সার্ভার চলছে: http://localhost:${PORT}`);
  console.log(`📡 Endpoint: POST /check-proxies`);
});
