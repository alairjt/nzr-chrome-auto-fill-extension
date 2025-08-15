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
  const language = (els.language && els.language.value) ? els.language.value : 'pt';
  const types = [];
  if (els.dataTypes) {
    els.dataTypes.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      if (chk.checked) types.push(chk.value);
    });
  }
  await chrome.storage.sync.set({ language, dataPanelTypes: types });
  els.status.textContent = 'Salvo!';
  els.status.className = 'ok';
  setTimeout(() => { els.status.textContent = ''; els.status.className = ''; }, 2000);
}

els.saveBtn.addEventListener('click', save);

load();
