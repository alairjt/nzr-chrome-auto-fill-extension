const statusEl = document.getElementById('status');
const dataPanelBtn = document.getElementById('dataPanelBtn');
const openOptionsLink = document.getElementById('openOptionsLink');
const screenAnnotatorBtn = document.getElementById('screenAnnotatorBtn');

// --- Language helpers ---
function i18n() {
  return {
    panelOpening: 'Abrindo painel de dados...',
    restricted: 'Esta página é restrita (ex: chrome://). Abra uma página web comum para usar.',
    noTab: 'Aba ativa não encontrada',
    errorPrefix: 'Erro',
  };
}

// Screen annotation button
if (screenAnnotatorBtn) {
  screenAnnotatorBtn.addEventListener('click', async () => {
    const t = i18n();
    screenAnnotatorBtn.classList.add('loading');
    setStatus('Ativando anotação na tela...');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error(t.noTab);
      if (isRestrictedUrl(tab.url)) {
        setStatus(`<span class="err">${t.restricted}</span>`, 'err');
        screenAnnotatorBtn.classList.remove('loading');
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_ANNOTATION_MODE' });
        window.close();
      } catch (e) {
        const injected = await ensureContentScript(tab.id);
        if (injected) {
          await chrome.tabs.sendMessage(tab.id, { type: 'START_ANNOTATION_MODE' });
          window.close();
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.warn('Failed to start annotation mode:', e);
      setStatus(`<span class="err">${t.errorPrefix}: ${e.message}</span>`, 'err');
      screenAnnotatorBtn.classList.remove('loading');
    }
  });
}

// Initialize UI
const t = i18n();

function setStatus(html, cls = '') {
  statusEl.className = `show ${cls}`;
  statusEl.innerHTML = html;
  
  // Limpar a mensagem após 3 segundos
  if (html) {
    setTimeout(() => {
      if (statusEl.innerHTML === html) {
        statusEl.classList.remove('show');
        setTimeout(() => {
          statusEl.innerHTML = '';
          statusEl.className = '';
        }, 300);
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

// Add click effect to cards
function addClickEffect(element) {
  element.addEventListener('click', function(event) {
    // Create ripple effect
    const ripple = document.createElement('div');
    ripple.style.cssText = `
      position: absolute;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.4);
      pointer-events: none;
      transform: scale(0);
      animation: ripple 0.6s linear;
      z-index: 1;
    `;
    
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (event.clientY - rect.top - size / 2) + 'px';
    
    element.appendChild(ripple);
    
    setTimeout(() => {
      ripple.remove();
    }, 600);
  });
}

// Add ripple effect styles
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `
  @keyframes ripple {
    to {
      transform: scale(2);
      opacity: 0;
    }
  }
  
  .action-card.loading {
    pointer-events: none;
    opacity: 0.7;
  }
  
  .action-card.loading::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 20px;
    height: 20px;
    margin: -10px 0 0 -10px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top: 2px solid white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(rippleStyle);

// Apply click effect to action cards
addClickEffect(dataPanelBtn);
addClickEffect(screenAnnotatorBtn);

// Data panel toggle button
dataPanelBtn.addEventListener('click', async () => {
  const t = i18n();
  dataPanelBtn.classList.add('loading');
  setStatus(t.panelOpening);
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(t.noTab);
    if (isRestrictedUrl(tab.url)) {
      setStatus(`<span class="err">${t.restricted}</span>`, 'err');
      dataPanelBtn.classList.remove('loading');
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
    dataPanelBtn.classList.remove('loading');
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

// Help link handler
const helpLink = document.getElementById('helpLink');
if (helpLink) {
  helpLink.addEventListener('click', async (e) => {
    e.preventDefault();
    setStatus('Abrindo ajuda...');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error(t.noTab);
      if (isRestrictedUrl(tab.url)) {
        setStatus(`<span class="err">${t.restricted}</span>`, 'err');
        return;
      }
      
      try {
        // First try to start annotation mode, then show help
        await chrome.tabs.sendMessage(tab.id, { type: 'START_ANNOTATION_MODE' });
        setTimeout(async () => {
          await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_HELP_MODAL' });
        }, 500);
        window.close();
      } catch (e) {
        const injected = await ensureContentScript(tab.id);
        if (injected) {
          await chrome.tabs.sendMessage(tab.id, { type: 'START_ANNOTATION_MODE' });
          setTimeout(async () => {
            await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_HELP_MODAL' });
          }, 500);
          window.close();
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.warn('Failed to show help:', e);
      setStatus(`<span class="err">Erro ao abrir ajuda: ${e.message}</span>`, 'err');
    }
  });
}
