// contentScript.js
// Scans forms, collects contextual info, asks background AI for suggestions, and fills fields.

(function () {
    'use strict';
  
    const EXCLUDED_TYPES = new Set([
      'password', 'hidden', 'file', 'submit', 'button', 'image', 'range', 'color', 'reset'
    ]);
  
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // --- Language helpers (cached for sync usage) ---
    let LANG_CACHE = 'pt';
    let I18N_CACHE = makeI18n('pt');

    function makeI18n() {
      return {
        overlayLoading: 'Preenchendo automaticamente...',
        defaultInput: 'Preenchido automaticamente',
        defaultTextarea: 'Texto gerado automaticamente.',
        errNoFocused: 'Nenhum elemento em foco',
        errElemUnsupported: 'Elemento não suportado',
        errTypeUnsupported: 'Tipo de input não suportado',
        errDuringFill: 'Erro durante preenchimento',
        errAIFail: 'Falha na IA',
      };
    }

    async function ensureLang() {
      LANG_CACHE = 'pt';
      I18N_CACHE = makeI18n();
    }
  
    // Data panel state
    let DATA_PANEL_ENABLED = true;
    let DATA_PANEL_INSTANCE = null;
    let SELECTED_INPUT = null;
    let DATA_TYPES_VISIBLE = null; // null => all types visible
  
    // Funções de navegação entre abas removidas - não são mais utilizadas
  
    // Loading overlay utilities
    function createLoadingOverlay(text = 'Preenchendo automaticamente...') {
      let overlay = document.getElementById('cai-loading-overlay');
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'cai-loading-overlay';
      overlay.setAttribute('aria-live', 'polite');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(17,24,39,0.45)';
      overlay.style.zIndex = '2147483647';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.backdropFilter = 'blur(1px)';
      overlay.style.pointerEvents = 'all';
  
      const box = document.createElement('div');
      box.style.background = 'white';
      box.style.color = '#111827';
      box.style.borderRadius = '10px';
      box.style.padding = '16px 18px';
      box.style.boxShadow = '0 10px 20px rgba(0,0,0,.12)';
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.gap = '12px';
  
      const spinner = document.createElement('div');
      spinner.style.width = '22px';
      spinner.style.height = '22px';
      spinner.style.border = '3px solid #e5e7eb';
      spinner.style.borderTopColor = '#2563eb';
      spinner.style.borderRadius = '50%';
      spinner.style.animation = 'cai-spin 1s linear infinite';
  
      const label = document.createElement('div');
      label.textContent = text;
      label.style.fontWeight = '600';
      label.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      label.style.fontSize = '14px';
  
      const style = document.createElement('style');
      style.textContent = '@keyframes cai-spin{to{transform:rotate(360deg)}}';
  
      box.appendChild(spinner);
      box.appendChild(label);
      overlay.appendChild(style);
      overlay.appendChild(box);
      document.documentElement.appendChild(overlay);
      return overlay;
    }
  
    function showLoadingOverlay(text) {
      const el = createLoadingOverlay(text);
      el.style.display = 'flex';
    }
  
    function hideLoadingOverlay() {
      const el = document.getElementById('cai-loading-overlay');
      if (!el) return;
      try { el.remove(); } catch (_) { el.style.display = 'none'; }
    }
  
    function hash(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h).toString(36);
    }
  
    function getLabel(el) {
      try {
        // aria-labelledby
        const ariaLbl = el.getAttribute('aria-labelledby');
        if (ariaLbl) {
          const t = ariaLbl
            .split(/\s+/)
            .map(id => {
              const n = document.getElementById(id);
              return n && n.innerText ? n.innerText.trim() : undefined;
            })
            .filter(Boolean)
            .join(' ');
          if (t) return t;
        }
        // label[for]
        if (el.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lbl) return lbl.innerText.trim();
        }
        // wrapping label
        let p = el.parentElement;
        while (p && p !== document.body) {
          if (p.tagName.toLowerCase() === 'label') return p.innerText.trim();
          p = p.parentElement;
        }
        return '';
      } catch { return ''; }
    }
  
    function getContextText(el, limit = 280) {
      const form = el.closest('form');
      const scope = form || el.closest('section, article, main, body') || document.body;
      const text = scope.innerText.replace(/\s+/g, ' ').trim();
      if (text.length <= limit) return text;
      const pos = Math.max(0, text.toLowerCase().indexOf(getLabel(el).toLowerCase()));
      const start = Math.max(0, pos - Math.floor(limit / 2));
      return text.substring(start, start + limit);
    }
  
    
    // Funções de stepper removidas
    
    // Funções de stepper removidas
  
    function getPageContext() {
      const metaEl = document.querySelector('meta[name="description"]');
      const metaDesc = (metaEl && metaEl.getAttribute) ? (metaEl.getAttribute('content') || '') : '';
      return { title: document.title, url: location.href, meta: metaDesc };
    }
  
    // --- React-safe setters & event dispatchers ---
    function setNativeProp(el, prop, value) {
      try {
        const proto = el.constructor && el.constructor.prototype;
        const desc = proto ? Object.getOwnPropertyDescriptor(proto, prop) : null;
        if (desc && typeof desc.set === 'function') {
          desc.set.call(el, value);
          return true;
        }
      } catch (_) {}
      try { el[prop] = value; return true; } catch (_) { return false; }
    }
    
    function setNativeValue(el, value) { return setNativeProp(el, 'value', value); }
    function setNativeChecked(el, checked) { return setNativeProp(el, 'checked', !!checked); }
  
    function fireInputEvents(el, { input = true, change = true } = {}) {
      try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (_) {}
      try { if (el && el.focus) el.focus(); } catch (_) {}
      if (input) {
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      }
      if (change) {
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
      }
    }
    // Funções de sugestão/autofill removidas

    function buildFieldFromElement(el) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const id = el.id || '';
      const name = el.name || '';
      const label = getLabel(el);
      const placeholder = el.getAttribute('placeholder') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const fieldKeyBase = [id, name, label, tag, type].filter(Boolean).join('|') || Math.random().toString(36).slice(2);
      const fieldId = 'fld_' + hash(fieldKeyBase);
      try { el.dataset.caiFieldId = fieldId; } catch (_) {}
      let options = undefined;
      if (tag === 'select') {
        options = [...el.options].map(o => ({ value: o.value, text: o.text }));
      }
      const field = {
        fieldId, tag, type, id, name, label, placeholder, ariaLabel,
        contextBefore: getContextText(el, 200),
        contextAfter: '',
        options
      };
      return field;
    }


  
    function coerceNumberInRange(n, min, max, step) {
      let v = Number(n);
      if (Number.isNaN(v)) v = (typeof min === 'number' ? min : 1) || 1;
      if (typeof min === 'number' && v < min) v = min;
      if (typeof max === 'number' && v > max) v = max;
      if (typeof step === 'number' && step > 0) {
        const base = typeof min === 'number' ? min : 0;
        const k = Math.round((v - base) / step);
        v = base + k * step;
      }
      return v;
    }
  
    function todayStr() {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    }
  
    function nowTimeStr() {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mi}`;
    }
    // Funções de preenchimento automático removidas - não são mais utilizadas
    function getDefaultValue(field) {
      // Generate default values for different field types
      if (field.type === 'email') return 'teste@exemplo.com';
      if (field.type === 'tel') return '(11) 99999-9999';
      if (field.type === 'date') return '15/03/1990';
      if (field.name && field.name.toLowerCase().includes('cpf')) return '11122233344';
      if (field.name && field.name.toLowerCase().includes('cnpj')) return '11222333000144';
      if (field.placeholder && field.placeholder.toLowerCase().includes('nome')) return 'João Silva';
      return I18N_CACHE.defaultInput;
    }

    // ===== DATA GENERATORS =====
    const DataGenerators = {
      nome: () => {
        const nomes = ['João Silva', 'Maria Santos', 'Pedro Oliveira', 'Ana Costa', 'Carlos Pereira', 'Lucia Ferreira', 'Paulo Rodrigues', 'Julia Almeida', 'Roberto Lima', 'Fernanda Ribeiro'];
        return nomes[Math.floor(Math.random() * nomes.length)];
      },
      
      email: () => {
        // Try to derive email from existing full name (panel or form), fallback to a random name
        const getDisplayedName = () => {
          try {
            const el = document.querySelector('.nzr-data-value[data-type="nome"]');
            const t = el && el.textContent ? el.textContent.trim() : '';
            return t;
          } catch { return ''; }
        };
        const getFormName = () => {
          try {
            const selectors = [
              'input[name*="nome" i]',
              'input[placeholder*="nome" i]',
              'input[id*="nome" i]'
            ];
            for (const sel of selectors) {
              const inp = document.querySelector(sel);
              if (inp && typeof inp.value === 'string') {
                const v = inp.value.trim();
                if (v.length >= 3) return v;
              }
            }
          } catch { /* ignore */ }
          return '';
        };
        
        let fullName = getDisplayedName() || getFormName() || DataGenerators.nome();
        
        // Sanitize: remove accents, special chars, and build first.last
        const slug = (s) => s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // strip diacritics
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ') // non-alnum to space
          .replace(/\s+/g, '.')
          .replace(/^\.+|\.+$/g, '');
        
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        const first = parts[0] ? slug(parts[0]) : 'user';
        const last = parts.length > 1 ? slug(parts[parts.length - 1]) : '';
        const local = last ? `${first}.${last}` : first;
        
        const dominios = ['gmail.com', 'hotmail.com', 'yahoo.com.br', 'outlook.com', 'empresa.com.br'];
        return `${local}@${dominios[Math.floor(Math.random() * dominios.length)]}`;
      },
      
      cpf: () => {
        // Generate 9 base digits
        const nums = [];
        for (let i = 0; i < 9; i++) {
          nums[i] = Math.floor(Math.random() * 10);
        }
        
        // Calculate first verification digit
        let sum = 0;
        for (let i = 0; i < 9; i++) {
          sum += nums[i] * (10 - i);
        }
        let remainder = sum % 11;
        nums[9] = remainder < 2 ? 0 : 11 - remainder;
        
        // Calculate second verification digit
        sum = 0;
        for (let i = 0; i < 10; i++) {
          sum += nums[i] * (11 - i);
        }
        remainder = sum % 11;
        nums[10] = remainder < 2 ? 0 : 11 - remainder;
        
        return nums.join('');
      },
      
      cnpj: () => {
        // Generate 12 base digits
        const nums = [];
        for (let i = 0; i < 12; i++) {
          nums[i] = Math.floor(Math.random() * 10);
        }
        
        // Calculate first verification digit
        const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
        let sum = 0;
        for (let i = 0; i < 12; i++) {
          sum += nums[i] * weights1[i];
        }
        let remainder = sum % 11;
        nums[12] = remainder < 2 ? 0 : 11 - remainder;
        
        // Calculate second verification digit  
        const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
        sum = 0;
        for (let i = 0; i < 13; i++) {
          sum += nums[i] * weights2[i];
        }
        remainder = sum % 11;
        nums[13] = remainder < 2 ? 0 : 11 - remainder;
        
        return nums.join('');
      },
      
      telefone: () => {
        // Gerar telefone celular brasileiro no formato (XX) XXXXX-XXXX
        const ddd = Math.floor(Math.random() * 67) + 11; // DDDs de 11 a 77
        const nono = 9; // Nono dígito sempre 9 para celular
        const primeiros4 = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const ultimos4 = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `(${ddd}) ${nono}${primeiros4}-${ultimos4}`;
      },
      
      uuid: () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
    };

    // ===== DATA PANEL =====
    function getDataTypeLabel(type) {
      const labels = {
        nome: 'Nome Completo',
        email: 'E-mail',
        cpf: 'CPF',
        cnpj: 'CNPJ',
        telefone: 'Telefone',
        uuid: 'UUID v4'
      };
      return labels[type] || type;
    }

    function createDataPanel() {
      if (DATA_PANEL_INSTANCE) return DATA_PANEL_INSTANCE;

      const panel = document.createElement('div');
      panel.id = 'nzr-data-panel';

      // Determine which types to render (fallback to all)
      const types = (Array.isArray(DATA_TYPES_VISIBLE) && DATA_TYPES_VISIBLE.length)
        ? DATA_TYPES_VISIBLE.filter(t => !!DataGenerators[t])
        : Object.keys(DataGenerators);

      panel.innerHTML = `
        <div class="nzr-panel-header">
          <span>Gerador de Dados</span>
          <button class="nzr-close-btn">×</button>
        </div>
        <div class="nzr-panel-content">
          <div class="nzr-selected-info">
            <span id="selected-input-info">Clique em um campo para selecioná-lo</span>
          </div>
          ${types.map(type => `
            <div class="nzr-data-item" data-type="${type}">
              <div class="nzr-data-header">
                <span class="nzr-data-label">${getDataTypeLabel(type)}</span>
                <button class="nzr-regenerate-btn" data-type="${type}">Gerar</button>
              </div>
              <div class="nzr-data-value" data-type="${type}">${DataGenerators[type]()}</div>
            </div>
          `).join('')}
        </div>
      `;

      // Add styles (once)
      if (!document.getElementById('nzr-data-panel-styles')) {
        const style = document.createElement('style');
        style.id = 'nzr-data-panel-styles';
        style.textContent = `
          #nzr-data-panel {
            position: fixed;
            top: 0;
            right: -320px;
            width: 320px;
            height: 100vh;
            background: #fff;
            border-left: 1px solid #e5e7eb;
            box-shadow: -2px 0 10px rgba(0,0,0,0.1);
            z-index: 10000;
            font-family: system-ui, -apple-system, sans-serif;
            transition: right 0.3s ease;
            overflow-y: auto;
          }
          #nzr-data-panel.open { right: 0; }
          .nzr-panel-header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-weight: 600;
          }
          .nzr-close-btn { background: none; border: none; font-size: 20px; cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
          .nzr-panel-content { padding: 16px; }
          .nzr-selected-info { background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; font-size: 12px; color: #0369a1; }
          .nzr-selected-info.has-selection { background: #ecfdf5; border-color: #22c55e; color: #166534; }
          .nzr-data-item { margin-bottom: 16px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; }
          .nzr-data-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
          .nzr-data-label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; }
          .nzr-data-value { background: #f3f4f6; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-family: monospace; font-size: 14px; margin-bottom: 8px; user-select: all; border: 1px solid transparent; transition: all 0.2s ease; }
          .nzr-data-value:hover { background: #e5e7eb; border-color: #2563eb; }
          .nzr-data-value:disabled { background: #f9fafb; color: #9ca3af; cursor: not-allowed; }
          .nzr-regenerate-btn { background: #2563eb; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
          .nzr-regenerate-btn:hover { background: #1d4ed8; }
          .nzr-selected-input { background: #fef3c7 !important; border: 2px solid #f59e0b !important; outline: none !important; }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(panel);
      setupPanelEvents(panel);
      DATA_PANEL_INSTANCE = panel;
      return panel;
    }
    
    function setupPanelEvents(panel) {
      // Close button
      panel.querySelector('.nzr-close-btn').addEventListener('click', () => {
        hideDataPanel();
      });
      
      // Regenerate buttons
      panel.querySelectorAll('.nzr-regenerate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const type = e.target.dataset.type;
          const valueEl = panel.querySelector(`.nzr-data-value[data-type="${type}"]`);
          valueEl.textContent = DataGenerators[type]();
        });
      });
      
      // Data value click - copy to clipboard
      panel.querySelectorAll('.nzr-data-value').forEach(el => {
        // Prevent mousedown from stealing focus from selected input
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
        });
        
        el.addEventListener('click', async (e) => {
          // Remove apenas os espaços em branco do início e do final do valor
          const value = e.target.textContent.trim();
          
          try {
            // Copy to clipboard
            await navigator.clipboard.writeText(value);
            
            // Show feedback
            const originalText = e.target.textContent;
            e.target.textContent = 'OK!';
            e.target.style.color = '#059669';
            
            // Reset after 1.5 seconds
            setTimeout(() => {
              e.target.textContent = originalText;
              e.target.style.color = '';
            }, 1500);
           
            // Restore focus to the last focused input and paste the value
            const lastFocusedInput = document.querySelector('input:focus, textarea:focus, select:focus, [contenteditable]:focus');
            if (lastFocusedInput) {
              setTimeout(() => {
                // Focus the input
                lastFocusedInput.focus();
                
                // For contenteditable elements
                if (lastFocusedInput.contentEditable === 'true') {
                  // Save current selection
                  const selection = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(lastFocusedInput);
                  range.collapse(false); // Move cursor to end
                  selection.removeAllRanges();
                  selection.addRange(range);
                  
                  // Insert the value
                  document.execCommand('insertText', false, value);
                } 
                // For regular inputs
                else {
                  // Insert the value at cursor position
                  const startPos = lastFocusedInput.selectionStart;
                  const endPos = lastFocusedInput.selectionEnd;
                  const currentValue = lastFocusedInput.value;
                  
                  lastFocusedInput.value = currentValue.substring(0, startPos) + 
                                         value + 
                                         currentValue.substring(endPos, currentValue.length);
                  
                  // Set cursor position after the inserted text
                  const newCursorPos = startPos + value.length;
                  lastFocusedInput.setSelectionRange(newCursorPos, newCursorPos);
                  
                  // Trigger input and change events
                  lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
                  lastFocusedInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Trigger any React/Angular change handlers
                if (lastFocusedInput._valueTracker) {
                  lastFocusedInput._valueTracker.setValue(lastFocusedInput.value);
                }
                
                // For Angular forms
                if (lastFocusedInput.dispatchEvent) {
                  lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
                  lastFocusedInput.dispatchEvent(new Event('blur', { bubbles: true }));
                  lastFocusedInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
              }, 100);
            }
            
          } catch (err) {
            console.error('Falha ao copiar para a área de transferência:', err);
            showMessage('Erro ao copiar para a área de transferência');
          }
        });
        
        // Add hover effect
        el.style.cursor = 'pointer';
        el.title = 'Clique para copiar';
      });
      
      // Also prevent mousedown on regenerate buttons
      panel.querySelectorAll('.nzr-regenerate-btn').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
        });
      });
      
      // Setup input selection tracking
      setupInputSelection();
    }
    
    function setupInputSelection() {
      document.querySelectorAll('input, textarea, select').forEach(input => {
        if (input.dataset.nzrSelectionSetup) return;
        input.dataset.nzrSelectionSetup = 'true';
        
        input.addEventListener('focus', () => {
          selectInput(input);
        });
        
        input.addEventListener('click', () => {
          selectInput(input);
        });
        
        // Don't clear selection when input loses focus due to panel interaction
        input.addEventListener('blur', (e) => {
          // Only clear selection if focus is going to a non-panel element
          setTimeout(() => {
            const activeElement = document.activeElement;
            const isPanelElement = activeElement && (
              activeElement.closest('#nzr-data-panel') || 
              activeElement.id === 'nzr-data-panel'
            );
            
            // Don't clear selection if clicking on panel
            if (!isPanelElement && input === SELECTED_INPUT) {
              // Keep the selection but remove visual focus indicator temporarily
              // The selection will be restored when clicking panel values
            }
          }, 10);
        });
      });
      
      // Restore previously selected input if it exists
      restoreSelectedInput();
    }
    
    function restoreSelectedInput() {
      const prevSelected = document.querySelector('[data-nzr-selected="true"]');
      if (prevSelected && !SELECTED_INPUT) {
        SELECTED_INPUT = prevSelected;
        prevSelected.classList.add('nzr-selected-input');
        updateSelectedInfo(prevSelected);
      }
    }
    
    function ensureSelectedInput() {
      console.log('ensureSelectedInput called, current SELECTED_INPUT:', SELECTED_INPUT);
      
      // Check if current selected input is still valid
      if (SELECTED_INPUT && !document.contains(SELECTED_INPUT)) {
        console.log('Current selected input no longer in DOM, clearing');
        SELECTED_INPUT = null;
      }
      
      // If we have a valid selected input, return it
      if (SELECTED_INPUT && document.contains(SELECTED_INPUT)) {
        console.log('Using current SELECTED_INPUT:', SELECTED_INPUT);
        return SELECTED_INPUT;
      }
      
      // Try to restore from data attribute
      const marked = document.querySelector('[data-nzr-selected="true"]');
      console.log('Looking for marked input, found:', marked);
      
      if (marked && document.contains(marked)) {
        SELECTED_INPUT = marked;
        marked.classList.add('nzr-selected-input');
        updateSelectedInfo(marked);
        console.log('Restored SELECTED_INPUT from marked element:', marked);
      } else {
        console.log('No valid selected input found');
      }
      
      return SELECTED_INPUT;
    }
    
    function selectInput(input) {
      console.log('selectInput called with:', input);
      
      // Clear previous selection
      if (SELECTED_INPUT) {
        console.log('Clearing previous selection:', SELECTED_INPUT);
        SELECTED_INPUT.classList.remove('nzr-selected-input');
        SELECTED_INPUT.dataset.nzrSelected = 'false';
      }
      
      // Clear any other marked inputs
      const previouslyMarked = document.querySelectorAll('[data-nzr-selected="true"]');
      console.log('Clearing previously marked inputs:', previouslyMarked.length);
      previouslyMarked.forEach(el => {
        el.classList.remove('nzr-selected-input');
        el.dataset.nzrSelected = 'false';
      });
      
      // Set new selection
      SELECTED_INPUT = input;
      input.classList.add('nzr-selected-input');
      
      // Store input reference persistently
      input.dataset.nzrSelected = 'true';
      console.log('Set new selection, SELECTED_INPUT is now:', SELECTED_INPUT);
      
      // Update panel info
      updateSelectedInfo(input);
    }
    
    function updateSelectedInfo(input) {
      console.log('updateSelectedInfo called with input:', input);
      
      if (!DATA_PANEL_INSTANCE) {
        console.log('No data panel instance found');
        return;
      }
      
      const infoEl = DATA_PANEL_INSTANCE.querySelector('#selected-input-info');
      const infoContainer = DATA_PANEL_INSTANCE.querySelector('.nzr-selected-info');
      
      console.log('Info elements found:', { infoEl, infoContainer });
      
      if (infoEl && infoContainer) {
        const label = getInputLabel(input);
        const type = input.type || input.tagName.toLowerCase();
        
        const displayText = `Selecionado: ${label} (${type})`;
        console.log('Updating panel info with:', displayText);
        
        infoEl.textContent = displayText;
        infoContainer.classList.add('has-selection');
        
        // Update data values availability
        updateDataValuesAvailability();
      }
    }
    
    function getInputLabel(input) {
      return input.placeholder || 
             input.getAttribute('aria-label') || 
             input.name || 
             input.id || 
             'Campo sem nome';
    }
    
    function updateDataValuesAvailability() {
      if (!DATA_PANEL_INSTANCE) return;
      
      const dataValues = DATA_PANEL_INSTANCE.querySelectorAll('.nzr-data-value');
      dataValues.forEach(el => {
        if (SELECTED_INPUT) {
          el.style.opacity = '1';
          el.style.cursor = 'pointer';
        } else {
          el.style.opacity = '0.5';
          el.style.cursor = 'not-allowed';
        }
      });
    }
    
    function fillInputAdvanced(input, value) {
      if (!input) return;
      
      // Detect framework type
      const isAngularMaterial = input.classList.contains('mat-input-element') || 
                               input.hasAttribute('matinput') ||
                               input.closest('.mat-form-field');
      
      const isAngular = input.hasAttribute('_ngcontent') || 
                       input.hasAttribute('formcontrolname') ||
                       document.querySelector('[ng-version]');
      
      const isReact = input.closest('[data-reactroot]') || 
                     window.React || 
                     document.querySelector('[data-react-helmet]');
      
      if (isAngularMaterial) {
        fillAngularMaterialInput(input, value);
      } else if (isAngular) {
        fillAngularInput(input, value);
      } else if (isReact) {
        fillReactInput(input, value);
      } else {
        fillInput(input, value);
      }
    }
    
    function fillAngularMaterialInput(input, value) {
      if (!input) return;
      
      // Check if input is disabled and temporarily enable it
      const wasDisabled = input.disabled || input.hasAttribute('disabled');
      if (wasDisabled) {
        input.disabled = false;
        input.removeAttribute('disabled');
      }
      
      // Angular Material specific approach
      input.focus();
      
      // Clear existing value
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Set new value
      input.value = value;
      
      // Trigger Angular Material events
      const events = [
        'input',
        'change', 
        'blur',
        'keyup',
        'focus'
      ];
      
      events.forEach(eventType => {
        input.dispatchEvent(new Event(eventType, { bubbles: true }));
      });
      
      // Force Angular change detection
      setTimeout(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Try to trigger ngModel update manually
        if (input.value !== value) {
          simulateTyping(input, value);
        }
        
        // Restore disabled state if it was disabled
        if (wasDisabled) {
          setTimeout(() => {
            input.disabled = true;
            input.setAttribute('disabled', '');
          }, 100);
        }
      }, 50);
      
      // Visual feedback
      input.style.backgroundColor = '#f0fdf4';
      input.style.borderColor = '#22c55e';
      
      showMessage(`Campo Angular Material preenchido: ${value}`);
    }
    
    function fillAngularInput(input, value) {
      if (!input) return;
      
      // Check if input is disabled and temporarily enable it
      const wasDisabled = input.disabled || input.hasAttribute('disabled');
      if (wasDisabled) {
        input.disabled = false;
        input.removeAttribute('disabled');
      }
      
      input.focus();
      input.value = value;
      
      // Angular specific events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      
      // Force change detection
      setTimeout(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Restore disabled state if it was disabled
        if (wasDisabled) {
          setTimeout(() => {
            input.disabled = true;
            input.setAttribute('disabled', '');
          }, 100);
        }
      }, 10);
      
      input.style.backgroundColor = '#f0fdf4';
      input.style.borderColor = '#22c55e';
      
      showMessage(`Campo Angular preenchido: ${value}`);
    }
    
    function fillReactInput(input, value) {
      if (!input) return;
      
      // React specific approach
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, value);
      
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);
      
      input.style.backgroundColor = '#f0fdf4';
      input.style.borderColor = '#22c55e';
      
      showMessage(`Campo React preenchido: ${value}`);
    }

    function fillInput(input, value) {
      if (!input) return;
      
      // Clear the field first
      input.value = '';
      input.focus();
      
      // Set the value
      input.value = value;
      
      // Trigger multiple events to ensure compatibility with different frameworks
      const events = [
        new Event('input', { bubbles: true, cancelable: true }),
        new Event('change', { bubbles: true, cancelable: true }),
        new Event('keyup', { bubbles: true, cancelable: true }),
        new Event('keydown', { bubbles: true, cancelable: true }),
        new Event('blur', { bubbles: true, cancelable: true }),
        new Event('focus', { bubbles: true, cancelable: true })
      ];
      
      events.forEach(event => {
        try {
          input.dispatchEvent(event);
        } catch (e) {
          console.warn('Failed to dispatch event:', event.type, e);
        }
      });
      
      // For Angular Material and other frameworks, try to trigger ngModel updates
      if (input.value !== value) {
        input.value = value;
      }
      
      // Force change detection for Angular
      setTimeout(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Final verification - if still not working, try simulation approach
        if (input.value !== value) {
          simulateTyping(input, value);
        }
      }, 10);
      
      // Visual feedback
      input.style.backgroundColor = '#f0fdf4';
      input.style.borderColor = '#22c55e';
      
      // Show success message
      showMessage(`Campo preenchido com: ${value}`);
    }
    
    function simulateTyping(input, value) {
      // Alternative approach: simulate actual typing
      input.focus();
      input.value = '';
      
      // Clear any existing value
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
      
      // Type each character
      for (let i = 0; i < value.length; i++) {
        const char = value[i];
        input.value += char;
        
        // Simulate key events for each character
        input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      }
      
      // Final events
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    
    function showMessage(text) {
      // Create or update message element
      let msgEl = document.querySelector('#nzr-message');
      if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.id = 'nzr-message';
        msgEl.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #1f2937;
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-family: system-ui, sans-serif;
          z-index: 10001;
          max-width: 300px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transform: translateX(100%);
          transition: transform 0.3s ease;
        `;
        document.body.appendChild(msgEl);
      }
      
      msgEl.textContent = text;
      msgEl.style.transform = 'translateX(0)';
      
      setTimeout(() => {
        msgEl.style.transform = 'translateX(100%)';
      }, 3000);
    }
    
    function showDataPanel() {
      const panel = createDataPanel();
      panel.classList.add('open');
      setupInputSelection(); // Setup input selection tracking
      updateDataValuesAvailability(); // Update initial state
    }
    
    function hideDataPanel() {
      if (DATA_PANEL_INSTANCE) {
        DATA_PANEL_INSTANCE.classList.remove('open');
      }
    }
    
    function toggleDataPanel() {
      if (DATA_PANEL_INSTANCE && DATA_PANEL_INSTANCE.classList.contains('open')) {
        hideDataPanel();
      } else {
        showDataPanel();
      }
    }
    
    // Carrega preferências do painel (quais tipos exibir)
    try {
      chrome.storage.sync.get({ dataPanelTypes: null }, (cfg) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('Erro ao carregar dataPanelTypes:', chrome.runtime.lastError);
        }
        DATA_TYPES_VISIBLE = Array.isArray(cfg?.dataPanelTypes) ? cfg.dataPanelTypes : null;
      });
    } catch (e) {
      console.warn('Falha ao acessar storage.sync:', e);
      DATA_TYPES_VISIBLE = null;
    }

    // Painel de dados sempre disponível (configuração removida)
    
    // Adiciona menu de contexto
    document.addEventListener('contextmenu', function(event) {
      const target = event.target;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) {
        SELECTED_INPUT = target;
        // Adiciona uma marcação visual para mostrar que o campo pode ser preenchido
        target.classList.add('nzr-autofill-target');
        
        // Remove a marcação após um tempo ou quando o mouse sair do elemento
        const removeHighlight = () => {
          target.classList.remove('nzr-autofill-target');
          target.removeEventListener('mouseleave', removeHighlight);
        };
        
        // Remove a marcação após 3 segundos ou quando o mouse sair do elemento
        setTimeout(removeHighlight, 3000);
        target.addEventListener('mouseleave', removeHighlight);
      }
    }, true);
    
    // Adiciona estilos para a marcação visual
    const style = document.createElement('style');
    style.textContent = `
      .nzr-autofill-target {
        outline: 2px solid #4CAF50 !important;
        outline-offset: 2px;
        transition: outline-color 0.3s ease;
      }
      .nzr-autofill-target:hover {
        outline-color: #2196F3 !important;
      }
    `;
    document.head.appendChild(style);
    
    // Cria itens do menu de contexto
    chrome.runtime.sendMessage({type: 'SETUP_CONTEXT_MENU'});
    
    // Função para preencher campo com tipo específico
    function fillFieldWithType(field, type) {
      if (!field) return;
      
      const t = type;
      const generator = DataGenerators[t];
      if (generator && typeof generator === 'function') {
        const value = generator();
        fillInput(field, value);
        showMessage(`Campo preenchido com ${getDataTypeLabel(t)}`);
      }
    }
    
    // Expõe a função para uso externo
    window.fillFieldWithType = fillFieldWithType;
    
    // Debug function - can be called from console
    window.debugDataPanel = function() {
      console.log('=== Data Panel Debug Info ===');
      console.log('DATA_PANEL_ENABLED:', DATA_PANEL_ENABLED);
      console.log('DATA_PANEL_INSTANCE:', DATA_PANEL_INSTANCE);
      console.log('SELECTED_INPUT:', SELECTED_INPUT);
      console.log('Marked inputs:', document.querySelectorAll('[data-nzr-selected="true"]'));
      console.log('Panel open:', DATA_PANEL_INSTANCE?.classList.contains('open'));
      console.log('============================');
    };
  
    // Handle messages from background script
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // Handle fill field request from context menu
      if (msg && msg.type === 'FILL_FIELD_WITH_TYPE' && msg.dataType) {
        if (SELECTED_INPUT) {
          fillFieldWithType(SELECTED_INPUT, msg.dataType);
          sendResponse({status: 'success', message: `Campo preenchido com ${msg.dataType}`});
        } else {
          sendResponse({status: 'error', message: 'Nenhum campo selecionado. Clique com o botão direito em um campo de formulário.'});
        }
        return true;
      }
      
      // Handle data panel toggle
      if (msg && msg.type === 'TOGGLE_DATA_PANEL') {
        toggleDataPanel();
        sendResponse({status: 'success', message: 'Painel de dados alternado', ok: true});
        return true;
      }
    });
    
    // Keyboard shortcut for data panel (Alt+Shift+D)
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'D' || e.code === 'KeyD')) {
        e.preventDefault();
        toggleDataPanel();
      }
    });
  })();
  