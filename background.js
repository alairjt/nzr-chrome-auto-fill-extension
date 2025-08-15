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
  if (command === 'toggle-data-panel') {
    try {
      // Se a tab não foi fornecida, tenta obter a tab ativa
      if (!tab || !tab.id) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) return;
        tab = activeTab;
      }
      
      if (isRestrictedUrl(tab.url)) return; // Ignora páginas restritas
      
      // Tenta enviar a mensagem para o content script
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DATA_PANEL' });
      } catch (e) {
        // Se falhar, tenta injetar o content script primeiro
        const injected = await ensureContentScript(tab.id);
        if (injected) {
          try { 
            await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DATA_PANEL' }); 
          } catch (err) {
            console.error('Erro ao alternar painel de dados:', err);
          }
        }
      }
    } catch (e) {
      console.error('Erro ao processar comando de teclado:', e);
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


