document.getElementById('openOptions').addEventListener('click', async (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
});

const statusEl = document.getElementById('status');
const btn = document.getElementById('autofillBtn');

// --- Language helpers ---
async function getLanguage() {
  try {
    const { language } = await chrome.storage.sync.get({ language: 'pt' });
    return (language === 'manezinho') ? 'manezinho' : 'pt';
  } catch { return 'pt'; }
}

function i18n(lang) {
  const L = (lang === 'manezinho');
  return {
    btnLabel: L ? 'Preenche aí, manezinho' : 'Preencher agora',
    analyzing: L ? 'Ô manezinho, tô catando as coisas e preenchendo...' : 'Analisando página e preenchendo...',
    restricted: L ? 'Essa página é das interna (tipo chrome://). Abre um site comum, tá?' : 'Esta página é restrita (ex: chrome://). Abra uma página web comum para usar.',
    noTab: L ? 'Não achei a aba ativa, ó' : 'Aba ativa não encontrada',
    success: (n) => L ? `Campos preenchidos: ${n}` : `Campos preenchidos: ${n}`,
    errorPrefix: L ? 'Eita, deu ruim' : 'Erro',
    fileHint: (hint) => hint,
  };
}

// Initialize localized UI
(async () => {
  const lang = await getLanguage();
  const t = i18n(lang);
  try { btn.textContent = t.btnLabel; } catch (_) {}
})();

function setStatus(html, cls = '') {
  statusEl.className = cls;
  statusEl.innerHTML = html;
}

function isRestrictedUrl(url) {
  // Only restrict known internal schemes. If URL is unavailable, don't block.
  return typeof url === 'string' && /^(chrome(-extension)?|edge|about|chrome-search):/i.test(url);
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
    return true;
  } catch (e) {
    console.warn('Failed to inject content script:', e);
    return false;
  }
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  const lang = await getLanguage();
  const t = i18n(lang);
  setStatus(t.analyzing);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(t.noTab);
    if (isRestrictedUrl(tab.url)) {
      throw new Error(t.restricted);
    }

    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_AUTOFILL' });
    } catch (e) {
      // No receiver: try to inject content script and retry
      const injected = await ensureContentScript(tab.id);
      if (!injected) throw e;
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_AUTOFILL' });
    }

    if (!resp?.ok) throw new Error(resp?.error || (lang === 'manezinho' ? 'Não deu pra preencher agora' : 'Falha no preenchimento'));
    setStatus(`<span class="ok">${t.success(resp.filled)}</span>`, 'ok');
  } catch (e) {
    const hint = (location && location.href && location.href.startsWith('chrome-extension://')) ?
      ' Se estiver testando um arquivo local (file://), habilite "Permitir acesso a URLs de arquivos" na página da extensão.' : '';
    setStatus(`<span class="err">${t.errorPrefix}: ${e.message}${hint}</span>`, 'err');
  } finally {
    btn.disabled = false;
  }
});
