document.getElementById('openOptions').addEventListener('click', async (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
});

const statusEl = document.getElementById('status');
const btn = document.getElementById('autofillBtn');

function setStatus(html, cls = '') {
  statusEl.className = cls;
  statusEl.innerHTML = html;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome(-extension)?|edge|about|chrome-search):/i.test(url);
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
  setStatus('Analisando página e preenchendo...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Aba ativa não encontrada');
    if (isRestrictedUrl(tab.url)) {
      throw new Error('Esta página é restrita (ex: chrome://). Abra uma página web comum para usar.');
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

    if (!resp?.ok) throw new Error(resp?.error || 'Falha no preenchimento');
    setStatus(`<span class="ok">Campos preenchidos: ${resp.filled}</span>`, 'ok');
  } catch (e) {
    const hint = (location && location.href && location.href.startsWith('chrome-extension://')) ?
      ' Se estiver testando um arquivo local (file://), habilite "Permitir acesso a URLs de arquivos" na página da extensão.' : '';
    setStatus(`<span class="err">Erro: ${e.message}${hint}</span>`, 'err');
  } finally {
    btn.disabled = false;
  }
});
