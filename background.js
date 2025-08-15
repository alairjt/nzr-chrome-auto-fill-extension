// background.js (service worker)
// Handles context menus and keyboard shortcuts for NZR Autofill

chrome.runtime.onInstalled.addListener(() => {

  function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'nzr-autofill-menu',
        title: 'NZR Autofill',
        contexts: ['editable']
      }, () => {
        const dataTypes = [
          { id: 'nome', title: 'Nome' },
          { id: 'email', title: 'E-mail' },
          { id: 'cpf', title: 'CPF' },
          { id: 'cnpj', title: 'CNPJ' },
          { id: 'telefone', title: 'Telefone' },
          { id: 'uuid', title: 'UUID' }
        ];

        dataTypes.forEach(type => {
          chrome.contextMenus.create({
            parentId: 'nzr-autofill-menu',
            id: `nzr-fill-${type.id}`,
            title: type.title,
            contexts: ['editable'],
            onclick: (info, tab) => {
              if (tab?.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'FILL_FIELD_WITH_TYPE',
                  dataType: type.id
                });
              }
            }
          }, () => void chrome.runtime.lastError);
        });
      });
    });
  }

  try {
    createContextMenus();
  } catch (e) {
    console.error('Error creating context menus:', e);
  }
});

try {
  chrome.runtime.onStartup?.addListener(() => {
    try {
      createContextMenus();
    } catch (_) { /* ignore */ }
  });
} catch (_) { /* ignore */ }

// Handler para mensagens entre componentes da extensão
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handler para preenchimento de campo via menu de contexto
  if (msg?.type === 'FILL_FIELD_WITH_TYPE') {
    // Esta mensagem é tratada pelo content script
    return false;
  }
  
  // Handler para alternar o painel de dados via atalho de teclado
  if (msg?.type === 'TOGGLE_DATA_PANEL') {
    // Esta mensagem é tratada pelo content script
    return false;
  }

  // Captura a área visível da aba atual e retorna como data URL
  if (msg?.type === 'REQUEST_VISIBLE_TAB_CAPTURE') {
    try {
      const windowId = sender?.tab?.windowId;
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Falha na captura de tela' });
          return;
        }
        sendResponse({ ok: true, dataUrl });
      });
      return true; // async response
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'Erro inesperado na captura' });
      return false;
    }
  }

  // Abre uma nova aba com uma data URL (para visualizar/baixar a imagem)
  if (msg?.type === 'OPEN_DATA_URL_TAB' && typeof msg?.dataUrl === 'string') {
    try {
      chrome.tabs.create({ url: msg.dataUrl }).catch(() => {});
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'Não foi possível abrir a aba' });
    }
    return false;
  }
  
  // Resposta padrão para mensagens não reconhecidas
  sendResponse({ ok: false, error: 'Tipo de mensagem não suportado' });
  return false;
});

// Verifica se a URL é uma URL restrita (páginas internas do Chrome)
function isRestrictedUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') || 
         url.startsWith('chrome-extension://') ||
         url.startsWith('about:');
}

// Injeta o content script na aba especificada
async function ensureContentScript(tabId) {
  try {
    // Tenta injetar o content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['contentScript.js']
    });
    return true;
  } catch (e) {
    console.error('Erro ao injetar content script:', e);
    return false;
  }
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command, tab) => {
  // Common tab handling logic
  async function getActiveTab(providedTab) {
    if (providedTab && providedTab.id) return providedTab;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab;
  }
  
  // Common message sending logic with script injection fallback
  async function sendMessageWithFallback(tabId, message) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      const injected = await ensureContentScript(tabId);
      if (injected) {
        try {
          await chrome.tabs.sendMessage(tabId, message);
        } catch (err) {
          console.error('Erro ao enviar mensagem:', err);
          throw err;
        }
      } else {
        throw e;
      }
    }
  }
  
  if (command === 'toggle-data-panel') {
    try {
      tab = await getActiveTab(tab);
      if (!tab?.id || isRestrictedUrl(tab.url)) return;
      
      await sendMessageWithFallback(tab.id, { type: 'TOGGLE_DATA_PANEL' });
    } catch (e) {
      console.error('Erro ao alternar painel de dados:', e);
    }
  }
  
  if (command === 'start-annotation-mode') {
    console.log('🎯 Comando start-annotation-mode recebido!');
    try {
      tab = await getActiveTab(tab);
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        console.log('❌ Tab inválida ou URL restrita');
        return;
      }
      
      console.log('✅ Enviando mensagem START_ANNOTATION_MODE para tab:', tab.id);
      await sendMessageWithFallback(tab.id, { type: 'START_ANNOTATION_MODE' });
      console.log('✅ Mensagem enviada com sucesso!');
    } catch (e) {
      console.error('❌ Erro ao iniciar modo de anotação:', e);
    }
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId.startsWith('nzr-fill-')) {
    const dataType = info.menuItemId.replace('nzr-fill-', '');
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'FILL_FIELD_WITH_TYPE', dataType })
        .catch(err => console.error('Erro ao preencher campo:', err));
    }
  }
});


