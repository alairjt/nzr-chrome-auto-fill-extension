const statusEl = document.getElementById('status');
const dataPanelBtn = document.getElementById('dataPanelBtn');
const openOptionsLink = document.getElementById('openOptionsLink');

// --- Language helpers ---
function i18n() {
  return {
    panelOpening: 'Abrindo painel de dados...',
    restricted: 'Esta página é restrita (ex: chrome://). Abra uma página web comum para usar.',
    noTab: 'Aba ativa não encontrada',
    errorPrefix: 'Erro',
  };
}

// Initialize UI
const t = i18n();

function setStatus(html, cls = '') {
  statusEl.className = cls;
  statusEl.innerHTML = html;
  
  // Limpar a mensagem após 3 segundos
  if (html) {
    setTimeout(() => {
      if (statusEl.innerHTML === html) {
        statusEl.innerHTML = '';
        statusEl.className = '';
      }
    }, 3000);
  }
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

// Data panel toggle button
dataPanelBtn.addEventListener('click', async () => {
  const t = i18n();
  setStatus(t.panelOpening);
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(t.noTab);
    if (isRestrictedUrl(tab.url)) {
      setStatus(`<span class="err">${t.restricted}</span>`, 'err');
      return;
    }
    
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DATA_PANEL' });
      window.close(); // Fecha o popup após abrir o painel
    } catch (e) {
      // Try to inject content script and retry
      const injected = await ensureContentScript(tab.id);
      if (injected) {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DATA_PANEL' });
        window.close(); // Fecha o popup após abrir o painel
      } else {
        throw e;
      }
    }
  } catch (e) {
    console.warn('Failed to toggle data panel:', e);
    setStatus(`<span class="err">${t.errorPrefix}: ${e.message}</span>`, 'err');
  }
});

// Open options page (outside of ensureContentScript)
if (openOptionsLink) {
  openOptionsLink.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      if (chrome.runtime.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
      } else {
        const url = chrome.runtime.getURL('options.html');
        await chrome.tabs.create({ url });
      }
      window.close();
    } catch (err) {
      console.warn('Failed to open options page:', err);
      setStatus('<span class="err">Não foi possível abrir as configurações.</span>', 'err');
    }
  });
}
