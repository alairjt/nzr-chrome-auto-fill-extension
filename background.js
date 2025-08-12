// background.js (service worker)
// Handles AI provider calls (OpenAI/Gemini) and settings

const DEFAULTS = {
  provider: 'openai',
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-1.5-flash',
  language: 'pt',
};

chrome.runtime.onInstalled.addListener(() => {
  // Initialize defaults without overwriting existing
  chrome.storage.sync.get(null, (cfg) => {
    const toSet = {};
    if (!cfg.provider) toSet.provider = DEFAULTS.provider;
    if (!cfg.openaiModel) toSet.openaiModel = DEFAULTS.openaiModel;
    if (!cfg.geminiModel) toSet.geminiModel = DEFAULTS.geminiModel;
    if (!cfg.language) toSet.language = DEFAULTS.language;
    if (Object.keys(toSet).length) chrome.storage.sync.set(toSet);
  });
  // Create context menu for focused autofill
  try {
    chrome.contextMenus.removeAll(async () => {
      try {
        const { language } = await chrome.storage.sync.get({ language: DEFAULTS.language });
        const title = (language === 'manezinho') ? 'Preenche esse campinho aí (NZR IA Autofill)' : 'Preencher este campo (NZR IA Autofill)';
        chrome.contextMenus.create({ id: 'nzr-autofill-focused', title, contexts: ['editable'] }, () => void chrome.runtime.lastError);
      } catch {
        chrome.contextMenus.create({ id: 'nzr-autofill-focused', title: 'Preencher este campo (NZR IA Autofill)', contexts: ['editable'] }, () => void chrome.runtime.lastError);
      }
    });
  } catch (_) { /* ignore */ }
});

// Also ensure context menu exists on startup (service worker reload)
try {
  chrome.runtime.onStartup?.addListener(() => {
    try {
      chrome.contextMenus.removeAll(async () => {
        try {
          const { language } = await chrome.storage.sync.get({ language: DEFAULTS.language });
          const title = (language === 'manezinho') ? 'Preenche esse campinho aí (NZR IA Autofill)' : 'Preencher este campo (NZR IA Autofill)';
          chrome.contextMenus.create({ id: 'nzr-autofill-focused', title, contexts: ['editable'] }, () => void chrome.runtime.lastError);
        } catch {
          chrome.contextMenus.create({ id: 'nzr-autofill-focused', title: 'Preencher este campo (NZR IA Autofill)', contexts: ['editable'] }, () => void chrome.runtime.lastError);
        }
      });
    } catch (_) { /* ignore */ }
  });
} catch (_) { /* ignore */ }

// Update context menu when language changes
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!changes.language) return;
    try {
      chrome.contextMenus.removeAll(async () => {
        try {
          const { newValue } = changes.language;
          const lang = newValue || DEFAULTS.language;
          const title = (lang === 'manezinho') ? 'Preenche esse campinho aí (NZR IA Autofill)' : 'Preencher este campo (NZR IA Autofill)';
          chrome.contextMenus.create({ id: 'nzr-autofill-focused', title, contexts: ['editable'] }, () => void chrome.runtime.lastError);
        } catch {
          chrome.contextMenus.create({ id: 'nzr-autofill-focused', title: 'Preencher este campo (NZR IA Autofill)', contexts: ['editable'] }, () => void chrome.runtime.lastError);
        }
      });
    } catch (_) { /* ignore */ }
  });
} catch (_) { /* ignore */ }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'AI_SUGGEST') {
    (async () => {
      try {
        const cfg = await getSettings();
        const lang = cfg.language === 'manezinho' ? 'manezinho' : 'pt';
        const T = (s) => {
          if (lang !== 'manezinho') return s;
          switch (s) {
            case 'Nenhuma API key configurada. Vá em Opções e informe a chave da OpenAI ou do Gemini.':
              return 'Sem chave, manezinho! Vai nas opção e bota a da OpenAI ou do Gemini.';
            case 'Falha ao interpretar resposta da IA':
              return 'Não entendi o que a IA falou, ó';
            case 'Resposta vazia da OpenAI':
              return 'A OpenAI não disse nada, ué';
            case 'Resposta vazia do Gemini':
              return 'O Gemini ficou quieto, tchê';
            default:
              return s;
          }
        };
        const prompt = buildPrompt(msg.fields, msg.page, lang);
        const provider = resolveProvider(cfg);
        if (!cfg.openaiApiKey && !cfg.geminiApiKey) {
          throw new Error(T('Nenhuma API key configurada. Vá em Opções e informe a chave da OpenAI ou do Gemini.'));
        }
        const text = provider === 'gemini'
          ? await callGemini(prompt, cfg.geminiApiKey, cfg.geminiModel)
          : await callOpenAI(prompt, cfg.openaiApiKey, cfg.openaiModel);
        const parsed = parseSuggestions(text);
        if (!parsed) throw new Error(T('Falha ao interpretar resposta da IA'));
        sendResponse({ ok: true, suggestions: parsed.suggestions || [], raw: text });
      } catch (e) {
        console.error('AI_SUGGEST error:', e);
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // keep the message channel open for async
  }
});

// Context menu click handler: autofill only the focused element
try {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'nzr-autofill-focused') return;
    if (!tab?.id) return;
    if (isRestrictedUrl(tab.url)) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_FOCUSED' });
    } catch (e) {
      const injected = await ensureContentScript(tab.id);
      if (injected) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_FOCUSED' }); } catch (_) {}
      }
    }
  });
} catch (_) { /* ignore */ }

function buildPrompt(fields, page, lang = 'pt') {
  const isMane = lang === 'manezinho';
  const instructions = [
    'Retorne SOMENTE JSON válido, sem explicações.',
    'Para cada campo, escolha o valor mais adequado considerando rótulo, placeholder, tipo e contexto.',
    'NUNCA invente informações sensíveis (ex: CPF aleatório) sem sinais claros de intenção do usuário.',
    'Se um valor não puder ser determinado com razoável confiança, omita-o (não inclua no array).',
    'Respeite formatos comuns: e-mail válido, telefone com DDD, datas ISO-8601 se aplicável.',
    'Prefira informações explícitas no contexto da página (ex: dados do usuário visíveis).',
  ];
  if (isMane) {
    instructions.push(
      'Atenção ao estilo: quando o campo for de TEXTO LIVRE (ex.: comentários, observações, descrições), use um tom leve e divertido no linguajar manezinho de Floripa, sem ofensas.',
      'IMPORTANTE: Não altere formatos obrigatórios ou dados estruturados (e-mail, telefone, CPF, datas, números). Para esses, use o formato padrão brasileiro.',
      'Mantenha o conteúdo coerente com o contexto da página; seja sucinto e natural.'
    );
  }
  const payload = {
    task: 'Preencher automaticamente campos de formulários com base no contexto da página.',
    language: isMane ? 'pt-BR (Manezinho de Floripa)' : 'pt-BR',
    dialect: isMane ? 'manezinho' : 'pt',
    instructions,
    page: {
      title: page?.title || '',
      url: page?.url || '',
      meta: page?.meta || '',
    },
    fields: fields?.map((f) => ({
      fieldId: f.fieldId,
      tag: f.tag,
      type: f.type,
      name: f.name,
      id: f.id,
      label: f.label,
      placeholder: f.placeholder,
      ariaLabel: f.ariaLabel,
      contextBefore: f.contextBefore,
      contextAfter: f.contextAfter,
      options: f.options || undefined,
    })) || [],
    output_schema: {
      suggestions: [
        {
          fieldId: 'id-do-campo',
          value: 'valor preenchido'
        }
      ]
    }
  };
  return `Você é um assistente que devolve apenas JSON.\n` +
         `Preencha os campos abaixo conforme o contexto.\n` +
         `${JSON.stringify(payload, null, 2)}`;
}

async function getSettings() {
  // Get all keys to include API keys
  const all = await chrome.storage.sync.get(null);
  return {
    provider: all.provider || DEFAULTS.provider,
    openaiModel: all.openaiModel || DEFAULTS.openaiModel,
    geminiModel: all.geminiModel || DEFAULTS.geminiModel,
    openaiApiKey: all.openaiApiKey || '',
    geminiApiKey: all.geminiApiKey || '',
    language: all.language || DEFAULTS.language,
  };
}

function resolveProvider(cfg) {
  // Honor explicit provider when key exists; otherwise fall back
  if (cfg.provider === 'openai') {
    if (cfg.openaiApiKey) return 'openai';
    if (cfg.geminiApiKey) return 'gemini';
    return 'openai';
  }
  if (cfg.provider === 'gemini') {
    if (cfg.geminiApiKey) return 'gemini';
    if (cfg.openaiApiKey) return 'openai';
    return 'gemini';
  }
  // Default fallback
  return cfg.openaiApiKey ? 'openai' : (cfg.geminiApiKey ? 'gemini' : DEFAULTS.provider);
}

async function callOpenAI(prompt, apiKey, model) {
  if (!apiKey) throw new Error('Configure a chave da OpenAI em Opções.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULTS.openaiModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Você devolve apenas JSON válido, sem comentários.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI erro ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Resposta vazia da OpenAI');
  return text;
}

async function callGemini(prompt, apiKey, model) {
  if (!apiKey) throw new Error('Configure a chave do Gemini em Opções.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULTS.geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: prompt }] }
      ],
      generationConfig: { temperature: 0.2 }
    }),
  });
  if (!res.ok) throw new Error(`Gemini erro ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Resposta vazia do Gemini');
  return text;
}

function parseSuggestions(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    // Try to extract JSON code block
    const m = text.match(/```(?:json)?\n([\s\S]*?)\n```/i);
    if (m) {
      try { return JSON.parse(m[1]); } catch (_) {}
    }
    // Try to find first {...}
    const m2 = text.match(/\{[\s\S]*\}/);
    if (m2) {
      try { return JSON.parse(m2[0]); } catch (_) {}
    }
  }
  return null;
}

function isRestrictedUrl(url) {
  // Only restrict known internal schemes. If URL is unavailable (e.g., no tabs permission), don't block.
  return typeof url === 'string' && /^(chrome(-extension)?|edge|about|chrome-search):/i.test(url);
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
    return true;
  } catch (e) {
    console.warn('Failed to inject content script from background:', e);
    return false;
  }
}

// Keyboard command: trigger autofill on the active tab
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'autofill-now') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (isRestrictedUrl(tab.url)) return; // ignore restricted pages
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_AUTOFILL' });
    } catch (e) {
      const injected = await ensureContentScript(tab.id);
      if (injected) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_AUTOFILL' }); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('Command handler error:', e);
  }
});
