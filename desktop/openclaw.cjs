const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(require('electron').app.getPath('userData'), 'aura-openclaw.json');

function cleanBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function loadConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveConfig(patch = {}) {
  const current = loadConfig();
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function getConfig() {
  const file = loadConfig();
  const baseUrl = cleanBase(process.env.OPENCLAW_GATEWAY_URL || file.url || 'http://127.0.0.1:18789');
  const token = String(process.env.OPENCLAW_GATEWAY_TOKEN || file.token || '').trim();
  const agentId = String(process.env.OPENCLAW_AGENT_ID || file.agentId || 'main').trim() || 'main';
  return { baseUrl, token, agentId };
}

async function request(pathname, options = {}) {
  const cfg = getConfig();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;

  const response = await fetch(cfg.baseUrl + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || ('HTTP ' + response.status);
    throw new Error('OpenClaw: ' + message);
  }
  return data;
}

async function status() {
  const cfg = getConfig();
  const result = {
    configured: Boolean(cfg.token),
    url: cfg.baseUrl,
    agentId: cfg.agentId,
    reachable: false,
    authenticated: false
  };

  try {
    const models = await request('/v1/models');
    result.reachable = true;
    result.authenticated = true;
    result.models = Array.isArray(models?.data)
      ? models.data.slice(0, 20).map(x => ({ id: x?.id, object: x?.object }))
      : [];
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    return result;
  }
}

async function chat(input, options = {}) {
  const cfg = getConfig();
  if (!cfg.token) {
    throw new Error(
      'OpenClaw tokenu ayarlı değil. OPENCLAW_GATEWAY_TOKEN ortam değişkenini ayarla veya AURA OpenClaw ayarına token ekle.'
    );
  }

  const body = {
    model: String(options.model || 'openclaw'),
    input: String(input || ''),
    user: String(options.user || 'aura-desktop-user'),
    ...(options.previousResponseId ? { previous_response_id: options.previousResponseId } : {})
  };

  const data = await request('/v1/responses', {
    method: 'POST',
    body,
    headers: {
      'x-openclaw-agent-id': cfg.agentId,
      'x-openclaw-session-key': 'aura:' + cfg.agentId
    }
  });

  const output = Array.isArray(data?.output) ? data.output : [];
  const parts = [];
  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content?.type === 'output_text' && content.text) parts.push(String(content.text));
      }
    }
  }

  return {
    ok: true,
    text: parts.join('\n').trim() || String(data?.output_text || '').trim(),
    responseId: data?.id || null,
    model: data?.model || body.model
  };
}

function configure(options = {}) {
  const url = cleanBase(options.url);
  const token = String(options.token || '').trim();
  const agentId = String(options.agentId || 'main').trim() || 'main';
  if (!url) throw new Error('OpenClaw Gateway adresi boş.');
  if (!/^https?:\/\//i.test(url)) throw new Error('OpenClaw Gateway adresi http:// veya https:// ile başlamalı.');
  return saveConfig({ url, token, agentId });
}

module.exports = {
  status,
  chat,
  configure,
  getConfig
};
