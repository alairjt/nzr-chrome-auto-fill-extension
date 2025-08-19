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

// Add ripple effect to save button
function addRippleEffect(element) {
  element.addEventListener('click', function(e) {
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
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    
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
  
  .btn-primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    pointer-events: none;
  }
`;
document.head.appendChild(rippleStyle);

// Add hover effects to checkbox items
function addCheckboxEffects() {
  const checkboxItems = document.querySelectorAll('.checkbox-item');
  checkboxItems.forEach(item => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    
    // Click anywhere on the item to toggle checkbox
    item.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
    
    // Visual feedback when checkbox changes
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        item.style.background = 'rgba(16, 185, 129, 0.2)';
        item.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      } else {
        item.style.background = 'rgba(255, 255, 255, 0.1)';
        item.style.borderColor = 'transparent';
      }
    });
  });
}

// Add entrance animations
function addEntranceAnimations() {
  const settingCards = document.querySelectorAll('.setting-card');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
      }
    });
  });
  
  settingCards.forEach(card => {
    observer.observe(card);
  });
}

els.saveBtn.addEventListener('click', save);
addRippleEffect(els.saveBtn);
addCheckboxEffects();
addEntranceAnimations();

load();
