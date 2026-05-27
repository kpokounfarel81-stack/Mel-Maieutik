// Serveur HTTP local + proxy IA pour Maieutik
const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnvFile('.env.local');
loadEnvFile('.env');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';

const AI_CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY || '',
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash:free'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/ai/stream' && req.method === 'POST') {
    await handleAiStream(req, res);
    return;
  }

  serveStaticFile(req, res);
});

startServer(PORT);

function startServer(port) {
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && port < PORT + 10) {
      console.log(`Port ${port} occupe, essai sur ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, HOST, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Serveur Maieutik lance');
  console.log(`URL: http://${HOST}:${port}`);
  console.log(`Modele IA: ${AI_CONFIG.model}`);
  console.log(`Proxy IA: ${AI_CONFIG.apiKey ? 'configure' : 'cle manquante'}`);
  console.log(`${'='.repeat(60)}\n`);
  });
}

process.on('SIGINT', () => {
  console.log('\nArret du serveur...');
  server.close(() => process.exit(0));
});

function loadEnvFile(fileName) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

async function handleAiStream(req, res) {
  if (!AI_CONFIG.apiKey) {
    sendJson(res, 500, {
      error: 'DEEPSEEK_API_KEY ou OPENROUTER_API_KEY manquante dans .env.local'
    });
    return;
  }

  try {
    const payload = await readJson(req);
    const requestBody = buildAiRequest(payload);

    const upstream = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_CONFIG.apiKey}`,
        'HTTP-Referer': process.env.APP_URL || `http://${HOST}:${PORT}`,
        'X-Title': process.env.APP_NAME || 'Maieutik'
      },
      body: JSON.stringify(requestBody)
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      sendJson(res, upstream.status, { error: parseUpstreamError(text) });
      return;
    }

    writeSseHeaders(res);
    await relayOpenAiStream(upstream, res);
  } catch (error) {
    console.error('Erreur proxy IA:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || 'Erreur proxy IA' });
    } else {
      writeSse(res, 'error', { error: error.message || 'Erreur proxy IA' });
      res.end();
    }
  }
}

function buildAiRequest(payload = {}) {
  const mode = payload.mode || 'solve';
  const problemStatement = String(payload.problemStatement || '').trim();
  const attempt = String(payload.attempt || '').trim();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  if (!problemStatement && attachments.length === 0) {
    throw new Error('Ajoutez un enonce ou une piece jointe.');
  }

  return {
    model: AI_CONFIG.model,
    stream: true,
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: systemPromptForMode(mode)
      },
      {
        role: 'user',
        content: buildUserContent(problemStatement, attempt, attachments)
      }
    ]
  };
}

function systemPromptForMode(mode) {
  const shared = [
    'Tu es un tuteur IA francophone pour Maieutik.',
    'Reponds en Markdown clair avec LaTeX quand utile.',
    'Ne donne pas de chaine de pensee privee; donne une demarche pedagogique concise, verifiable et utile.',
    'Si une image ou un PDF est joint mais illisible, demande une transcription courte.'
  ].join(' ');

  const modes = {
    solve: 'Mode: resolution complete. Structure: ## Demarche puis ## Solution.',
    hint: 'Mode: indice progressif. Ne donne pas directement la reponse finale. Donne 2 ou 3 indices gradues.',
    guide: 'Mode: maieutique. Pose des questions guidees et propose la prochaine petite etape.',
    review: 'Mode: correction de tentative. Repere les erreurs, valide ce qui est juste, puis donne une correction ciblee.',
    explain: 'Mode: expliquer autrement. Donne une analogie simple, une methode alternative, puis un mini-exemple.'
  };

  return `${shared}\n${modes[mode] || modes.solve}`;
}

function buildUserContent(problemStatement, attempt, attachments) {
  const textParts = [];
  if (problemStatement) textParts.push(`Enonce:\n${problemStatement}`);
  if (attempt) textParts.push(`Tentative de l'utilisateur:\n${attempt}`);
  const textContent = textParts.join('\n\n') || 'Analyse les pieces jointes.';

  if (!attachments.length) {
    return textContent;
  }

  const content = [{ type: 'text', text: textContent }];

  for (const attachment of attachments.slice(0, 3)) {
    if (!attachment || !attachment.dataUrl) continue;
    if (String(attachment.type || '').startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl }
      });
    } else if (attachment.type === 'application/pdf') {
      content.push({
        type: 'file',
        file: {
          filename: attachment.name || 'document.pdf',
          file_data: attachment.dataUrl
        }
      });
    }
  }

  return content;
}

async function relayOpenAiStream(upstream, res) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let reasoning = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;

      try {
        const parsed = JSON.parse(raw);
        const delta = parsed.choices?.[0]?.delta || {};
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          writeSse(res, 'reasoning', { delta: delta.reasoning_content, reasoning });
        }
        if (delta.content) {
          fullContent += delta.content;
          writeSse(res, 'solution', { delta: delta.content, solution: fullContent });
        }
      } catch (error) {
        console.warn('Chunk IA ignore:', error.message);
      }
    }
  }

  const parsed = splitReasoningAndSolution(reasoning, fullContent);
  writeSse(res, 'done', parsed);
  res.end();
}

function splitReasoningAndSolution(reasoning, content) {
  let finalReasoning = reasoning;
  let finalSolution = content;

  if (!finalReasoning && content) {
    const reasoningMatch = content.match(/##\s*(Raisonnement|Demarche|Démarche)\s*[\r\n]+([\s\S]*?)(?=##\s*Solution|$)/i);
    const solutionMatch = content.match(/##\s*Solution\s*[\r\n]+([\s\S]*)/i);
    if (reasoningMatch) finalReasoning = reasoningMatch[2].trim();
    if (solutionMatch) finalSolution = solutionMatch[1].trim();
  }

  return {
    reasoning: finalReasoning || 'Demarche integree dans la reponse.',
    solution: finalSolution || content || 'Solution indisponible'
  };
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error('Requete trop volumineuse.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseUpstreamError(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.message || text;
  } catch {
    return text || 'Erreur API IA';
  }
}

function serveStaticFile(req, res) {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';

  const filePath = path.normalize(path.join(__dirname, requestPath));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acces interdit');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? '404 - Fichier non trouve' : '500 - Erreur serveur');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
}
