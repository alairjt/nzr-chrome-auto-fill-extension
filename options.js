const els = {
  provider: [...document.querySelectorAll('input[name="provider"]')],
  openaiKey: document.getElementById('openaiKey'),
  openaiModel: document.getElementById('openaiModel'),
  geminiKey: document.getElementById('geminiKey'),
  geminiModel: document.getElementById('geminiModel'),
  saveBtn: document.getElementById('saveBtn'),
  status: document.getElementById('status'),
};

async function load() {
  const cfg = await chrome.storage.sync.get({ provider: 'openai', openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-1.5-flash' });
  els.openaiModel.value = cfg.openaiModel || 'gpt-4o-mini';
  els.geminiModel.value = cfg.geminiModel || 'gemini-1.5-flash';

  // Keys are not returned by default for privacy unless previously stored
  const keys = await chrome.storage.sync.get(['openaiApiKey', 'geminiApiKey']);
  els.openaiKey.value = keys.openaiApiKey || '';
  els.geminiKey.value = keys.geminiApiKey || '';

  // Decide provider based on existing keys; if both present, honor stored provider
  let provider = cfg.provider || 'openai';
  if (keys.openaiApiKey && !keys.geminiApiKey) provider = 'openai';
  else if (!keys.openaiApiKey && keys.geminiApiKey) provider = 'gemini';
  els.provider.forEach(r => r.checked = (r.value === provider));
}

async function save() {
  const provider = els.provider.find(r => r.checked)?.value || 'openai';
  const openaiApiKey = els.openaiKey.value.trim();
  const openaiModel = els.openaiModel.value.trim() || 'gpt-4o-mini';
  const geminiApiKey = els.geminiKey.value.trim();
  const geminiModel = els.geminiModel.value.trim() || 'gemini-1.5-flash';
  await chrome.storage.sync.set({ provider, openaiApiKey, openaiModel, geminiApiKey, geminiModel });
  els.status.textContent = 'Salvo!';
  els.status.className = 'ok';
  setTimeout(() => { els.status.textContent = ''; els.status.className = ''; }, 2000);
}

els.saveBtn.addEventListener('click', save);

// Auto-select provider based on typing keys
els.openaiKey.addEventListener('input', () => {
  if (els.openaiKey.value.trim()) {
    els.provider.forEach(r => r.checked = (r.value === 'openai'));
  } else if (els.geminiKey.value.trim()) {
    els.provider.forEach(r => r.checked = (r.value === 'gemini'));
  }
});

els.geminiKey.addEventListener('input', () => {
  if (els.geminiKey.value.trim()) {
    els.provider.forEach(r => r.checked = (r.value === 'gemini'));
  } else if (els.openaiKey.value.trim()) {
    els.provider.forEach(r => r.checked = (r.value === 'openai'));
  }
});

load();
