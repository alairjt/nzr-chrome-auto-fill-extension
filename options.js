const els = {
  saveBtn: document.getElementById('saveBtn'),
  status: document.getElementById('status'),
  language: document.getElementById('language'),
  dataTypes: document.getElementById('dataTypes'),
};

async function load() {
  const cfg = await chrome.storage.sync.get({ language: 'pt', dataPanelTypes: null });
  if (els.language) els.language.value = cfg.language || 'pt';

  // Marca os checkboxes conforme armazenado, por padrão todos selecionados
  const selected = Array.isArray(cfg.dataPanelTypes) ? new Set(cfg.dataPanelTypes) : null;
  if (els.dataTypes) {
    els.dataTypes.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.checked = !selected || selected.size === 0 || selected.has(chk.value);
    });
  }
}

async function save() {
  try {
    // Add loading state to button
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = '⏳ Salvando...';
    
    const language = (els.language && els.language.value) ? els.language.value : 'pt';
    const types = [];
    if (els.dataTypes) {
      els.dataTypes.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        if (chk.checked) types.push(chk.value);
      });
    }
    
    await chrome.storage.sync.set({ language, dataPanelTypes: types });
    
    // Show success message
    els.status.textContent = '✅ Configurações salvas com sucesso!';
    els.status.className = 'status-message success show';
    
    // Reset button
    els.saveBtn.textContent = '💾 Salvar Configurações';
    els.saveBtn.disabled = false;
    
    // Clear message after 3 seconds
    setTimeout(() => { 
      els.status.classList.remove('show');
      setTimeout(() => {
        els.status.textContent = '';
        els.status.className = 'status-message';
      }, 300);
    }, 3000);
  } catch (error) {
    // Show error message
    els.status.textContent = '❌ Erro ao salvar configurações';
    els.status.className = 'status-message error show';
    
    // Reset button
    els.saveBtn.textContent = '💾 Salvar Configurações';
    els.saveBtn.disabled = false;
    
    // Clear error after 4 seconds
    setTimeout(() => { 
      els.status.classList.remove('show');
      setTimeout(() => {
        els.status.textContent = '';
        els.status.className = 'status-message';
      }, 300);
    }, 4000);
  }
}

els.saveBtn.addEventListener('click', save);

load();
