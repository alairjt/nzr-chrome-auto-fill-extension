// contentScript.js
// Scans forms, collects contextual info, asks background AI for suggestions, and fills fields.

(function () {
    'use strict';
  
    const EXCLUDED_TYPES = new Set([
      'password', 'hidden', 'file', 'submit', 'button', 'image', 'range', 'color', 'reset'
    ]);
  
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Pin helpers ---
function updatePinUI(panel) {
  if (!panel) return;
  const pinBtn = panel.querySelector('.nzr-pin-btn');
  if (pinBtn) {
    pinBtn.classList.toggle('active', !!DATA_PANEL_PINNED);
    pinBtn.setAttribute('aria-pressed', String(!!DATA_PANEL_PINNED));
    pinBtn.title = DATA_PANEL_PINNED ? 'Desafixar painel' : 'Fixar painel';
  }
}

function applyPinnedLayout(panel) {
  // Only offset layout if panel is open and pinned
  const isOpen = panel && panel.classList && panel.classList.contains('open');
  if (isOpen && DATA_PANEL_PINNED) {
    document.body.classList.add('nzr-panel-pinned');
  } else {
    document.body.classList.remove('nzr-panel-pinned');
  }
}

function setPinned(value, persist = true, panel = DATA_PANEL_INSTANCE) {
  DATA_PANEL_PINNED = !!value;
  updatePinUI(panel);
  applyPinnedLayout(panel);
  if (persist) {
    try {
      chrome.storage.sync.set({ dataPanelPinned: DATA_PANEL_PINNED });
    } catch (e) {
      console.warn('Falha ao salvar dataPanelPinned:', e);
    }
  }
}

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
    let DATA_PANEL_PINNED = false; // when true, page content is offset so panel doesn't overlay
  
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
      
      cep: () => {
        // CEP brasileiro no formato 00000-000
        const left = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const right = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `${left}-${right}`;
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
        cep: 'CEP',
        uuid: 'UUID v4'
      };
      return labels[type] || type;
    }

    function getDataTypeIcon(type) {
      const icons = {
        nome: '👤',
        email: '📧',
        cpf: '🆔',
        cnpj: '🏢',
        telefone: '📱',
        cep: '📮',
        uuid: '🔑'
      };
      return icons[type] || '📝';
    }

    function getDataTypeDescription(type) {
      const descriptions = {
        nome: 'Nome brasileiro fictício',
        email: 'Endereço de e-mail válido',
        cpf: 'CPF com dígitos verificadores',
        cnpj: 'CNPJ com dígitos verificadores',
        telefone: 'Número de celular brasileiro',
        cep: 'CEP brasileiro no formato 00000-000',
        uuid: 'Identificador único universal'
      };
      return descriptions[type] || 'Dado gerado automaticamente';
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
          <div class="nzr-header-content">
            <div class="nzr-header-icon">🎲</div>
            <div class="nzr-header-text">
              <h2>Gerador de Dados</h2>
              <span class="nzr-header-subtitle">Dados fictícios para testes</span>
            </div>
          </div>
          <div class="nzr-header-actions">
            <button class="nzr-pin-btn" title="Fixar painel" aria-pressed="false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14.85 2.15a.5.5 0 01.7 0l6.3 6.3a.5.5 0 010 .7l-4.07 4.07a2.5 2.5 0 00-.66 1.17l-.49 1.95a1 1 0 01-1.22.73l-3.32-.89-4.95 4.95a.75.75 0 11-1.06-1.06l4.95-4.95-.9-3.32a1 1 0 01.73-1.21l1.95-.49c.43-.11.84-.34 1.17-.66l4.07-4.07z" fill="currentColor"/>
              </svg>
            </button>
            <button class="nzr-close-btn" title="Fechar painel">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="nzr-panel-content">
          <div class="nzr-selected-info" id="selected-info-container">
            <div class="nzr-info-icon">ℹ️</div>
            <div class="nzr-info-content">
              <span id="selected-input-info">Clique em um campo para selecioná-lo</span>
            </div>
          </div>
          
          <div class="nzr-data-grid">
            ${types.map(type => `
              <div class="nzr-data-card" data-type="${type}">
                <div class="nzr-card-header">
                  <div class="nzr-card-icon">${getDataTypeIcon(type)}</div>
                  <div class="nzr-card-title">
                    <span class="nzr-data-label">${getDataTypeLabel(type)}</span>
                    <span class="nzr-data-description">${getDataTypeDescription(type)}</span>
                  </div>
                  <button class="nzr-regenerate-btn" data-type="${type}" title="Gerar novo ${getDataTypeLabel(type)}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C9.95703 1.5 11.707 2.38281 12.8906 3.78125L11 5.5H15V1.5L13.4062 3.09375C11.8906 1.23438 10.0469 0.5 8 0.5C3.85938 0.5 0.5 3.85938 0.5 8C0.5 12.1406 3.85938 15.5 8 15.5C11.1562 15.5 13.8594 13.4062 14.4062 10.5H13.3594C12.8594 12.8125 10.6406 14.5 8 14.5C4.41015 14.5 1.5 11.5898 1.5 8Z" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
                <div class="nzr-data-value" data-type="${type}" title="Clique para copiar">${DataGenerators[type]()}</div>
                <div class="nzr-card-actions">
                  <button class="nzr-fill-btn" data-type="${type}" title="Preencher campo selecionado">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1L11 6L6 11L1 6L6 1Z" stroke="currentColor" stroke-width="1" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="nzr-panel-footer">
            <button class="nzr-bulk-action-btn" id="regenerateAll" title="Gerar todos os dados novamente">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M13 7A6 6 0 1 1 7 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M13 3V7H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Gerar Todos
            </button>
            <button class="nzr-bulk-action-btn" id="clearSelection" title="Limpar seleção atual">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 5L9 9M9 5L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Limpar
            </button>
          </div>
        </div>
      `;

      // Add styles (once)
      if (!document.getElementById('nzr-data-panel-styles')) {
        const style = document.createElement('style');
        style.id = 'nzr-data-panel-styles';
        style.textContent = `
          /* Main Panel Container */
          #nzr-data-panel {
            position: fixed !important;
            top: 0 !important;
            right: -400px !important;
            width: 400px !important;
            height: 100vh !important;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            border-left: 1px solid rgba(255, 255, 255, 0.1) !important;
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15) !important;
            z-index: 10000 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif !important;
            transition: right 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            overflow: hidden !important;
            backdrop-filter: blur(10px) !important;
          }
          #nzr-data-panel.open { right: 0 !important; }
          
          /* Header Styling */
          .nzr-panel-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            padding: 20px 24px !important;
            background: rgba(255, 255, 255, 0.1) !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
            backdrop-filter: blur(10px) !important;
          }
          
          .nzr-header-content {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
          }
          .nzr-header-actions {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
          }
          
          .nzr-header-icon {
            font-size: 24px !important;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1)) !important;
          }
          
          .nzr-header-text h2 {
            margin: 0 !important;
            font-size: 18px !important;
            font-weight: 700 !important;
            color: white !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1) !important;
          }
          
          .nzr-header-subtitle {
            font-size: 12px !important;
            color: rgba(255, 255, 255, 0.8) !important;
            font-weight: 500 !important;
          }
          
          .nzr-close-btn, .nzr-pin-btn {
            background: rgba(255, 255, 255, 0.1) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            border-radius: 8px !important;
            padding: 8px !important;
            cursor: pointer !important;
            color: white !important;
            transition: all 0.2s ease !important;
            backdrop-filter: blur(10px) !important;
          }
          .nzr-close-btn:hover, .nzr-pin-btn:hover {
            background: rgba(255, 255, 255, 0.2) !important;
            transform: scale(1.05) !important;
          }
          .nzr-pin-btn.active {
            background: rgba(34, 197, 94, 0.25) !important;
            border-color: rgba(34, 197, 94, 0.4) !important;
            color: #dcfce7 !important;
          }

          /* When pinned, offset page content to avoid overlay */
          body.nzr-panel-pinned {
            padding-right: 400px !important;
            transition: padding-right 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
          }
          
          /* Panel Content */
          .nzr-panel-content {
            padding: 20px 24px !important;
            height: calc(100vh - 80px) !important;
            overflow-y: auto !important;
            scrollbar-width: thin !important;
            scrollbar-color: rgba(255, 255, 255, 0.3) transparent !important;
          }
          
          .nzr-panel-content::-webkit-scrollbar {
            width: 6px !important;
          }
          .nzr-panel-content::-webkit-scrollbar-track {
            background: transparent !important;
          }
          .nzr-panel-content::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3) !important;
            border-radius: 3px !important;
          }
          .nzr-panel-content::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5) !important;
          }
          
          /* Selected Info Section */
          .nzr-selected-info {
            background: rgba(255, 255, 255, 0.95) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            border-radius: 12px !important;
            padding: 16px !important;
            margin-bottom: 20px !important;
            display: flex !important;
            align-items: flex-start !important;
            gap: 12px !important;
            backdrop-filter: blur(10px) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
            transition: all 0.3s ease !important;
          }
          
          .nzr-selected-info.has-selection {
            background: rgba(34, 197, 94, 0.95) !important;
            border-color: rgba(34, 197, 94, 0.3) !important;
            color: #166534 !important;
          }
          
          .nzr-info-icon {
            font-size: 16px !important;
            flex-shrink: 0 !important;
          }
          
          .nzr-info-content {
            flex: 1 !important;
          }
          
          #selected-input-info {
            font-size: 13px !important;
            font-weight: 600 !important;
            color: #374151 !important;
            display: block !important;
            margin-bottom: 4px !important;
          }
          
          .nzr-info-tip {
            font-size: 11px !important;
            color: #6b7280 !important;
            font-style: italic !important;
          }
          
          /* Data Grid */
          .nzr-data-grid {
            display: grid !important;
            gap: 16px !important;
            margin-bottom: 20px !important;
          }
          
          /* Data Cards */
          .nzr-data-card {
            background: rgba(255, 255, 255, 0.95) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            border-radius: 16px !important;
            padding: 20px !important;
            backdrop-filter: blur(10px) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            position: relative !important;
            overflow: hidden !important;
          }
          
          .nzr-data-card:hover {
            transform: translateY(-2px) !important;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15) !important;
            border-color: rgba(255, 255, 255, 0.4) !important;
          }
          
          .nzr-card-header {
            display: flex !important;
            align-items: flex-start !important;
            gap: 12px !important;
            margin-bottom: 16px !important;
          }
          
          .nzr-card-icon {
            font-size: 20px !important;
            flex-shrink: 0 !important;
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1)) !important;
          }
          
          .nzr-card-title {
            flex: 1 !important;
          }
          
          .nzr-data-label {
            font-size: 14px !important;
            font-weight: 700 !important;
            color: #1f2937 !important;
            display: block !important;
            margin-bottom: 2px !important;
          }
          
          .nzr-data-description {
            font-size: 11px !important;
            color: #6b7280 !important;
            font-weight: 500 !important;
          }
          
          .nzr-regenerate-btn {
            background: linear-gradient(135deg, #10b981, #059669) !important;
            border: none !important;
            border-radius: 8px !important;
            padding: 8px !important;
            cursor: pointer !important;
            color: white !important;
            transition: all 0.2s ease !important;
            box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3) !important;
            width: 32px !important;
            height: 32px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          
          .nzr-regenerate-btn:hover {
            transform: scale(1.05) !important;
            box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4) !important;
            background: linear-gradient(135deg, #059669, #047857) !important;
          }
          
          .nzr-regenerate-btn:active {
            transform: scale(0.95) !important;
            transition: transform 0.1s ease !important;
          }
          
          .nzr-regenerate-btn.nzr-animate-pulse svg {
            animation: nzr-spin 1s linear infinite !important;
          }
          
          @keyframes nzr-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          
          /* Data Value */
          .nzr-data-value {
            background: #f8fafc !important;
            border: 2px solid #e2e8f0 !important;
            border-radius: 12px !important;
            padding: 14px 16px !important;
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            color: #1e293b !important;
            cursor: pointer !important;
            user-select: all !important;
            transition: all 0.2s ease !important;
            word-break: break-all !important;
            line-height: 1.4 !important;
            margin-bottom: 12px !important;
            position: relative !important;
          }
          
          .nzr-data-value:hover {
            background: #e2e8f0 !important;
            border-color: #3b82f6 !important;
            transform: scale(1.02) !important;
          }
          
          .nzr-data-value:active {
            transform: scale(0.98) !important;
          }
          
          /* Card Actions */
          .nzr-card-actions {
            display: flex !important;
            gap: 8px !important;
            justify-content: flex-end !important;
          }
          
          .nzr-copy-btn, .nzr-fill-btn {
            background: rgba(107, 114, 128, 0.1) !important;
            border: 1px solid rgba(107, 114, 128, 0.2) !important;
            border-radius: 8px !important;
            padding: 8px !important;
            cursor: pointer !important;
            color: #6b7280 !important;
            transition: all 0.2s ease !important;
            width: 28px !important;
            height: 28px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          
          .nzr-copy-btn:hover {
            background: rgba(59, 130, 246, 0.1) !important;
            border-color: #3b82f6 !important;
            color: #3b82f6 !important;
          }
          
          .nzr-fill-btn:hover {
            background: rgba(34, 197, 94, 0.1) !important;
            border-color: #22c55e !important;
            color: #22c55e !important;
          }
          
          /* Panel Footer */
          .nzr-panel-footer {
            display: flex !important;
            gap: 12px !important;
            padding-top: 16px !important;
            border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
          }
          
          .nzr-bulk-action-btn {
            flex: 1 !important;
            background: rgba(255, 255, 255, 0.1) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            border-radius: 12px !important;
            padding: 12px 16px !important;
            color: white !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 8px !important;
            backdrop-filter: blur(10px) !important;
          }
          
          .nzr-bulk-action-btn:hover {
            background: rgba(255, 255, 255, 0.2) !important;
            transform: translateY(-1px) !important;
          }
          
          /* Selected Input Highlight */
          .nzr-selected-input {
            background: #fef3c7 !important;
            border: 2px solid #f59e0b !important;
            outline: none !important;
            box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1) !important;
          }
          
          /* Animation Classes */
          @keyframes nzr-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
          
          @keyframes nzr-bounce {
            0%, 20%, 53%, 80%, 100% { transform: translate3d(0,0,0); }
            40%, 43% { transform: translate3d(0,-8px,0); }
            70% { transform: translate3d(0,-4px,0); }
            90% { transform: translate3d(0,-1px,0); }
          }
          
          .nzr-animate-pulse { animation: nzr-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
          .nzr-animate-bounce { animation: nzr-bounce 1s ease-in-out; }
          
          /* Responsive design for smaller screens */
          @media (max-width: 500px) {
            #nzr-data-panel {
              width: 100vw !important;
              right: -100vw !important;
            }
            .nzr-panel-content {
              padding: 16px 20px !important;
            }
            .nzr-data-card {
              padding: 16px !important;
            }
          }
          
          /* High contrast mode support */
          @media (prefers-contrast: high) {
            .nzr-data-card {
              border: 2px solid #000 !important;
            }
            .nzr-data-value {
              border: 2px solid #000 !important;
            }
          }
          
          /* Reduced motion for accessibility */
          @media (prefers-reduced-motion: reduce) {
            * {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
            }
          }
          
          /* Dark mode styles */
          @media (prefers-color-scheme: dark) {
            .nzr-data-value {
              background: #1e293b !important;
              border-color: #475569 !important;
              color: #e2e8f0 !important;
            }
            .nzr-data-value:hover {
              background: #334155 !important;
            }
            .nzr-selected-info {
              background: rgba(30, 41, 59, 0.95) !important;
              color: #e2e8f0 !important;
            }
            .nzr-data-card {
              background: rgba(30, 41, 59, 0.95) !important;
            }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(panel);
      setupPanelEvents(panel);
      DATA_PANEL_INSTANCE = panel;
      // Initialize pin state from storage and reflect UI
      try {
        chrome.storage.sync.get({ dataPanelPinned: false }, (cfg) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('Erro ao carregar dataPanelPinned:', chrome.runtime.lastError);
          }
          setPinned(!!cfg?.dataPanelPinned, false, panel);
        });
      } catch (e) {
        console.warn('Falha ao acessar storage.sync para pin:', e);
        setPinned(false, false, panel);
      }
      setupPanelKeyboardNavigation(panel);

      return panel;
    }
    
    function setupPanelEvents(panel) {
      // Close button
      panel.querySelector('.nzr-close-btn').addEventListener('click', () => {
        hideDataPanel();
      });
      
      // Pin button
      const pinBtn = panel.querySelector('.nzr-pin-btn');
      if (pinBtn) {
        pinBtn.addEventListener('click', (e) => {
          e.preventDefault();
          setPinned(!DATA_PANEL_PINNED, true, panel);
        });
      }
      
      // Regenerate buttons
      panel.querySelectorAll('.nzr-regenerate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const button = e.currentTarget;
          const type = button.dataset.type;
          const valueEl = panel.querySelector(`.nzr-data-value[data-type="${type}"]`);
          
          // Add loading animation
          button.classList.add('nzr-animate-pulse');
          valueEl.classList.add('nzr-animate-pulse');
          
          setTimeout(() => {
            valueEl.textContent = DataGenerators[type]();
            button.classList.remove('nzr-animate-pulse');
            valueEl.classList.remove('nzr-animate-pulse');
            valueEl.classList.add('nzr-animate-bounce');
            
            setTimeout(() => {
              valueEl.classList.remove('nzr-animate-bounce');
            }, 1000);
          }, 300);
        });
      });
      
      // Copy buttons
      panel.querySelectorAll('.nzr-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const type = e.currentTarget.dataset.type;
          const valueEl = panel.querySelector(`.nzr-data-value[data-type="${type}"]`);
          const value = valueEl.textContent.trim();
          
          const success = await copyToClipboard(value);
          
          if (success) {
            showEnhancedMessage('✅ Copiado para área de transferência', 'success');
            
            // Visual feedback
            e.currentTarget.style.transform = 'scale(1.2)';
            e.currentTarget.style.color = '#22c55e';
            
            setTimeout(() => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.color = '';
            }, 200);
          } else {
            showEnhancedMessage('❌ Erro ao copiar para área de transferência', 'error');
          }
        });
      });
      
      // Fill buttons
      panel.querySelectorAll('.nzr-fill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const type = e.currentTarget.dataset.type;
          
          if (SELECTED_INPUT) {
            const valueEl = panel.querySelector(`.nzr-data-value[data-type="${type}"]`);
            const value = valueEl.textContent.trim();
            fillInput(SELECTED_INPUT, value);
            
            // Visual feedback
            e.currentTarget.style.transform = 'scale(1.2)';
            e.currentTarget.style.color = '#22c55e';
            
            setTimeout(() => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.color = '';
            }, 200);
            
            showEnhancedMessage(`✅ Campo preenchido com ${getDataTypeLabel(type)}`, 'success');
          } else {
            showEnhancedMessage('⚠️ Selecione um campo primeiro', 'warning');
          }
        });
      });
      
      // Data value click - enhanced copy behavior
      panel.querySelectorAll('.nzr-data-value').forEach(el => {
        el.addEventListener('mousedown', (e) => e.preventDefault());
        
        el.addEventListener('click', async (e) => {
          const value = e.target.textContent.trim();
          
          const success = await copyToClipboard(value);
          
          if (success) {
            // Enhanced visual feedback
            const originalBg = e.target.style.background;
            const originalBorder = e.target.style.borderColor;
            
            e.target.style.background = '#22c55e';
            e.target.style.borderColor = '#16a34a';
            e.target.style.color = 'white';
            e.target.style.transform = 'scale(1.02)';
            
            setTimeout(() => {
              e.target.style.background = originalBg;
              e.target.style.borderColor = originalBorder;
              e.target.style.color = '';
              e.target.style.transform = '';
            }, 300);
            
            showEnhancedMessage('📋 Copiado!', 'success');
            
            // Auto-fill if input is selected
            if (SELECTED_INPUT) {
              setTimeout(() => {
                fillInput(SELECTED_INPUT, value);
                showEnhancedMessage('✅ Campo preenchido automaticamente', 'success');
              }, 400);
            }
            
          } else {
            showEnhancedMessage('❌ Erro ao copiar para área de transferência', 'error');
          }
        });
      });
      
      // Bulk action buttons
      const regenerateAllBtn = panel.querySelector('#regenerateAll');
      if (regenerateAllBtn) {
        regenerateAllBtn.addEventListener('click', () => {
          const allValueElements = panel.querySelectorAll('.nzr-data-value');
          allValueElements.forEach((el, index) => {
            setTimeout(() => {
              const type = el.dataset.type;
              el.classList.add('nzr-animate-pulse');
              
              setTimeout(() => {
                el.textContent = DataGenerators[type]();
                el.classList.remove('nzr-animate-pulse');
                el.classList.add('nzr-animate-bounce');
                
                setTimeout(() => {
                  el.classList.remove('nzr-animate-bounce');
                }, 1000);
              }, 200);
            }, index * 100);
          });
          
          showEnhancedMessage('🎲 Todos os dados regenerados!', 'success');
        });
      }
      
      const clearSelectionBtn = panel.querySelector('#clearSelection');
      if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', () => {
          if (SELECTED_INPUT) {
            SELECTED_INPUT.classList.remove('nzr-selected-input');
            SELECTED_INPUT.dataset.nzrSelected = 'false';
            SELECTED_INPUT = null;
            
            const infoContainer = panel.querySelector('#selected-info-container');
            if (infoContainer) {
              infoContainer.classList.remove('has-selection');
              const infoText = panel.querySelector('#selected-input-info');
              if (infoText) {
                infoText.textContent = 'Clique em um campo para selecioná-lo';
              }
            }
            
            updateDataValuesAvailability();
            showEnhancedMessage('🗑️ Seleção removida', 'info');
          }
        });
      }
      
      // Prevent mousedown on all buttons
      panel.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('mousedown', (e) => e.preventDefault());
      });
      
      // Setup input selection tracking
      setupInputSelection();
      
      // Add keyboard navigation
      setupPanelKeyboardNavigation(panel);
    }

    function setupPanelKeyboardNavigation(panel) {
      // Listen for keyboard shortcuts when panel is focused
      panel.addEventListener('keydown', (e) => {
        // ESC to close panel
        if (e.key === 'Escape') {
          e.preventDefault();
          hideDataPanel();
          return;
        }
        
        // R to regenerate all
        if (e.key.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const regenerateAllBtn = panel.querySelector('#regenerateAll');
          if (regenerateAllBtn) regenerateAllBtn.click();
          return;
        }
        
        // C to clear selection
        if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
          e.preventDefault();
          const clearBtn = panel.querySelector('#clearSelection');
          if (clearBtn) clearBtn.click();
          return;
        }
        
        // Number keys (1-6) to quickly regenerate specific data types
        if (e.key >= '1' && e.key <= '6') {
          e.preventDefault();
          const index = parseInt(e.key) - 1;
          const regenerateBtn = panel.querySelectorAll('.nzr-regenerate-btn')[index];
          if (regenerateBtn) regenerateBtn.click();
          return;
        }
      });
      
      // Make panel focusable for keyboard navigation
      panel.setAttribute('tabindex', '0');
      
      // Add focus management
      panel.addEventListener('focus', () => {
        panel.style.outline = '2px solid rgba(255, 255, 255, 0.5)';
      });
      
      panel.addEventListener('blur', () => {
        panel.style.outline = 'none';
      });
    }

    // Robust copy function with fallback
    async function copyToClipboard(text) {
      try {
        // Try modern clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
        // Fallback for older browsers or non-secure contexts
        return copyToClipboardFallback(text);
      } catch (err) {
        console.log('Clipboard API failed, trying fallback:', err);
        return copyToClipboardFallback(text);
      }
    }
    
    function copyToClipboardFallback(text) {
      try {
        // Create a temporary textarea element
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = `
          position: fixed;
          top: -1000px;
          left: -1000px;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
        `;
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        // Try execCommand
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        return successful;
      } catch (err) {
        console.error('Fallback copy failed:', err);
        return false;
      }
    }

    function showEnhancedMessage(text, type = 'info') {
      let msgEl = document.querySelector('#nzr-enhanced-message');
      if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.id = 'nzr-enhanced-message';
        msgEl.style.cssText = `
          position: fixed;
          top: 20px;
          right: 420px;
          background: #1f2937;
          color: white;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 13px;
          font-family: system-ui, sans-serif;
          font-weight: 600;
          z-index: 10001;
          max-width: 280px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          transform: translateX(100%);
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        `;
        document.body.appendChild(msgEl);
      }
      
      // Set colors based on type
      const colors = {
        success: { bg: '#10b981', border: '#059669' },
        error: { bg: '#ef4444', border: '#dc2626' },
        warning: { bg: '#f59e0b', border: '#d97706' },
        info: { bg: '#3b82f6', border: '#2563eb' }
      };
      
      const color = colors[type] || colors.info;
      msgEl.style.background = color.bg;
      msgEl.style.borderColor = color.border;
      
      msgEl.textContent = text;
      msgEl.style.transform = 'translateX(0)';
      
      // Clear any existing timeout
      if (msgEl.hideTimeout) {
        clearTimeout(msgEl.hideTimeout);
      }
      
      // Set new timeout to hide the message
      msgEl.hideTimeout = setTimeout(() => {
        msgEl.style.transform = 'translateX(100%)';
        
        // Remove element after animation completes
        setTimeout(() => {
          if (msgEl.parentNode) {
            msgEl.parentNode.removeChild(msgEl);
          }
        }, 400); // 400ms matches the transition duration
      }, 3000);
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
      if (!DATA_PANEL_INSTANCE) return;
      
      const infoEl = DATA_PANEL_INSTANCE.querySelector('#selected-input-info');
      const infoContainer = DATA_PANEL_INSTANCE.querySelector('#selected-info-container');
      
      if (infoEl && infoContainer) {
        const label = getInputLabel(input);
        const type = input.type || input.tagName.toLowerCase();
        const placeholder = input.placeholder || '';
        
        // Create enhanced display text with more details
        let displayText = `✅ Campo Selecionado: ${label}`;
        if (type !== 'text') displayText += ` (${type})`;
        if (placeholder && placeholder !== label) displayText += ` • "${placeholder}"`;

        infoEl.textContent = displayText;
        infoContainer.classList.add('has-selection');
        
        // Add a smooth transition effect
        infoContainer.style.transform = 'scale(1.02)';
        setTimeout(() => {
          infoContainer.style.transform = '';
        }, 200);
        
        // Update data values availability
        updateDataValuesAvailability();
        
        // Show notification
        showEnhancedMessage(`🎯 Campo "${label}" selecionado`, 'success');
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
      
      // Clear any existing timeout
      if (msgEl.hideTimeout) {
        clearTimeout(msgEl.hideTimeout);
      }
      
      // Set new timeout to hide the message
      msgEl.hideTimeout = setTimeout(() => {
        msgEl.style.transform = 'translateX(100%)';
        
        // Remove element after animation completes
        setTimeout(() => {
          if (msgEl.parentNode) {
            msgEl.parentNode.removeChild(msgEl);
          }
        }, 300); // 300ms matches the transition duration
      }, 3000);
    }
    
    function showDataPanel() {
      const panel = createDataPanel();
      panel.classList.add('open');
      // Apply layout if pinned
      applyPinnedLayout(panel);
      setupInputSelection(); // Setup input selection tracking
      updateDataValuesAvailability(); // Update initial state
    }
    
    function hideDataPanel() {
      if (DATA_PANEL_INSTANCE) {
        DATA_PANEL_INSTANCE.classList.remove('open');
        // Remove layout offset when hidden, regardless of pin state
        document.body.classList.remove('nzr-panel-pinned');
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
      }
    }
    
    // Expõe a função para uso externo
    window.fillFieldWithType = fillFieldWithType;
  
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
      return false;
    });
    
    // Keyboard shortcut for data panel (Alt+Shift+D)
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'D' || e.code === 'KeyD')) {
        e.preventDefault();
        toggleDataPanel();
      }
    });
  
    // --- Advanced Annotation and Drawing Mode ---
    let ANNOTATION = {
      active: false,
      canvas: null,
      ctx: null,
      toolbar: null,
      overlay: null,
      currentTool: 'select',
      isDrawing: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      strokeColor: '#ef4444',
      strokeWidth: 3,
      fillColor: 'rgba(239, 68, 68, 0.2)',
      fontSize: 16,
      selections: [],
      annotations: [],
      textElements: [],
      shapeElements: [],
      currentTextInput: null,
      draggedElement: null,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      dragOffsetX: 0,
      dragOffsetY: 0
    };

    function ensureAnnotationStyles() {
      if (document.getElementById('nzr-annotation-style')) return;
      const style = document.createElement('style');
      style.id = 'nzr-annotation-style';
      style.textContent = `
        .nzr-annotation-overlay {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 2147483647 !important;
          pointer-events: none !important;
          background: transparent !important;
        }
        .nzr-annotation-canvas {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          pointer-events: auto !important;
          cursor: crosshair !important;
        }
        .nzr-annotation-toolbar {
          position: fixed !important;
          top: 20px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 2147483648 !important;
          background: #1f2937 !important;
          border-radius: 12px !important;
          padding: 12px 16px !important;
          display: flex !important;
          gap: 8px !important;
          align-items: center !important;
          box-shadow: 0 10px 25px rgba(0,0,0,0.2) !important;
          font-family: system-ui, -apple-system, sans-serif !important;
          font-size: 14px !important;
          color: white !important;
          pointer-events: auto !important;
        }
        .nzr-tool-group {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
          padding: 0 8px !important;
          border-right: 1px solid #374151 !important;
          height: 100% !important;
        }
        .nzr-tool-group:last-child {
          border-right: none !important;
        }
        .nzr-tool-btn {
          background: #374151 !important;
          color: #d1d5db !important;
          border: none !important;
          border-radius: 6px !important;
          padding: 8px 10px !important;
          cursor: pointer !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          transition: all 0.2s ease !important;
          min-width: 32px !important;
          height: 32px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .nzr-tool-btn:hover {
          background: #4b5563 !important;
          color: white !important;
        }
        .nzr-tool-btn.active {
          background: #2563eb !important;
          color: white !important;
        }
        .nzr-color-input {
          width: 32px !important;
          height: 32px !important;
          border: none !important;
          border-radius: 6px !important;
          cursor: pointer !important;
          background: none !important;
          padding: 0 !important;
        }
        .nzr-range-input {
          width: 80px !important;
          height: 6px !important;
          background: #374151 !important;
          border-radius: 3px !important;
          outline: none !important;
          -webkit-appearance: none !important;
        }
        .nzr-range-input::-webkit-slider-thumb {
          appearance: none !important;
          width: 16px !important;
          height: 16px !important;
          border-radius: 50% !important;
          background: #2563eb !important;
          cursor: pointer !important;
        }
        .nzr-selection-area {
          position: absolute !important;
          border: 2px dashed #2563eb !important;
          background: rgba(37, 99, 235, 0.1) !important;
          pointer-events: auto !important;
        }
        .nzr-annotation-canvas.brush { cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" fill="%23ef4444"/></svg>') 12 12, auto !important; }
        .nzr-annotation-canvas.select { cursor: crosshair !important; }
        .nzr-annotation-canvas.rectangle { cursor: crosshair !important; }
        .nzr-annotation-canvas.circle { cursor: crosshair !important; }
        .nzr-annotation-canvas.arrow { cursor: crosshair !important; }
        .nzr-annotation-canvas.line { cursor: crosshair !important; }
        .nzr-annotation-canvas.text { cursor: text !important; }
        .nzr-annotation-canvas.move { cursor: grab !important; pointer-events: none !important; }
        .nzr-annotation-canvas.move.dragging { cursor: grabbing !important; }
        .nzr-moveable-element {
          cursor: grab !important;
          transition: transform 0.1s ease !important;
          pointer-events: auto !important;
          position: relative !important;
          z-index: 2147483649 !important;
        }
        .nzr-moveable-element:hover {
          transform: scale(1.02) !important;
          box-shadow: 0 0 10px rgba(37, 99, 235, 0.3) !important;
        }
        .nzr-moveable-element.dragging {
          cursor: grabbing !important;
          transform: scale(1.05) !important;
          box-shadow: 0 4px 20px rgba(37, 99, 235, 0.4) !important;
          z-index: 2147483650 !important;
        }
        .nzr-text-element.nzr-moveable-element {
          pointer-events: auto !important;
          user-select: none !important;
        }
        .nzr-shape-element {
          position: absolute !important;
          pointer-events: none !important;
          user-select: none !important;
          cursor: move !important;
        }
        .nzr-shape-element.nzr-moveable-element {
          pointer-events: auto !important;
        }
        .nzr-shape-element svg {
          display: block !important;
          width: 100% !important;
          height: 100% !important;
        }
        .nzr-save-dropdown {
          position: relative !important;
          display: inline-block !important;
        }
        .nzr-save-options {
          position: absolute !important;
          top: 100% !important;
          left: 0 !important;
          background: #1f2937 !important;
          border: 1px solid rgba(255, 255, 255, 0.2) !important;
          border-radius: 8px !important;
          min-width: 160px !important;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3) !important;
          z-index: 2147483649 !important;
          opacity: 0 !important;
          visibility: hidden !important;
          transform: translateY(-5px) !important;
          transition: all 0.2s ease !important;
          margin-top: 4px !important;
        }
        .nzr-save-dropdown:hover .nzr-save-options {
          opacity: 1 !important;
          visibility: visible !important;
          transform: translateY(0) !important;
        }
        .nzr-save-option {
          display: block !important;
          width: 100% !important;
          padding: 10px 12px !important;
          background: transparent !important;
          border: none !important;
          color: #d1d5db !important;
          font-size: 13px !important;
          font-weight: 500 !important;
          text-align: left !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          border-radius: 6px !important;
          margin: 2px !important;
        }
        .nzr-save-option:hover {
          background: rgba(59, 130, 246, 0.2) !important;
          color: #60a5fa !important;
        }
        .nzr-save-option:first-child {
          margin-top: 4px !important;
        }
        .nzr-save-option:last-child {
          margin-bottom: 4px !important;
        }
        .nzr-font-size {
          background: #374151 !important;
          color: #d1d5db !important;
          border: 1px solid rgba(255, 255, 255, 0.2) !important;
          border-radius: 6px !important;
          padding: 6px 8px !important;
          font-size: 12px !important;
          cursor: pointer !important;
          min-width: 70px !important;
          height: 32px !important;
          display: inline-block !important;
          visibility: visible !important;
          opacity: 1 !important;
          position: relative !important;
          z-index: 10001 !important;
        }
        .nzr-font-size:hover {
          background: #4b5563 !important;
          color: white !important;
        }
        .nzr-font-size option {
          background: #374151 !important;
          color: #d1d5db !important;
        }
        .nzr-text-input {
          position: absolute !important;
          background: rgba(255, 255, 255, 0.95) !important;
          border: 2px solid #2563eb !important;
          border-radius: 8px !important;
          padding: 8px 12px !important;
          font-family: system-ui, sans-serif !important;
          font-size: 16px !important;
          color: #1f2937 !important;
          outline: none !important;
          min-width: 200px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
          z-index: 2147483649 !important;
        }
        .nzr-text-element {
          position: absolute !important;
          font-family: system-ui, sans-serif !important;
          font-weight: 600 !important;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3) !important;
          pointer-events: auto !important;
          user-select: none !important;
          z-index: 2147483648 !important;
        }
      `;
      document.head.appendChild(style);
    }

    function createAnnotationCanvas() {
      const overlay = document.createElement('div');
      overlay.className = 'nzr-annotation-overlay';
      
      const canvas = document.createElement('canvas');
      canvas.className = 'nzr-annotation-canvas';
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      overlay.appendChild(canvas);
      document.documentElement.appendChild(overlay);
      
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      return { overlay, canvas, ctx };
    }

    function buildAnnotationToolbar() {
      const toolbar = document.createElement('div');
      toolbar.className = 'nzr-annotation-toolbar';
      
      toolbar.innerHTML = `
        <div class="nzr-tool-group">
          <button class="nzr-tool-btn active" data-tool="select" title="Seleção livre (S)">⬚</button>
          <button class="nzr-tool-btn" data-tool="brush" title="Pincel (B)">🖌</button>
          <button class="nzr-tool-btn" data-tool="text" title="Texto (T)">T</button>
          <button class="nzr-tool-btn" data-tool="move" title="Mover elementos (M)">✋</button>
        </div>
        <div class="nzr-tool-group">
          <button class="nzr-tool-btn" data-tool="rectangle" title="Retângulo (R)">▭</button>
          <button class="nzr-tool-btn" data-tool="circle" title="Círculo (C)">○</button>
          <button class="nzr-tool-btn" data-tool="arrow" title="Seta (A)">→</button>
          <button class="nzr-tool-btn" data-tool="line" title="Linha (L)">─</button>
        </div>
        <div class="nzr-tool-group">
          <input type="color" class="nzr-color-input" id="strokeColor" value="#ef4444" title="Cor do traço">
          <input type="range" class="nzr-range-input" id="strokeWidth" min="1" max="20" value="3" title="Espessura">
          <select class="nzr-font-size" id="fontSize" title="Tamanho da fonte">
            <option value="10">10px</option>
            <option value="12">12px</option>
            <option value="14">14px</option>
            <option value="16" selected>16px</option>
            <option value="18">18px</option>
            <option value="20">20px</option>
            <option value="24">24px</option>
            <option value="28">28px</option>
            <option value="32">32px</option>
            <option value="36">36px</option>
            <option value="48">48px</option>
            <option value="64">64px</option>
          </select>
        </div>
        <div class="nzr-tool-group">
          <button class="nzr-tool-btn" id="helpButton" title="Ajuda (H)">❓</button>
          <button class="nzr-tool-btn" id="clearAll" title="Limpar tudo">🗑</button>
          <div class="nzr-save-dropdown">
            <button class="nzr-tool-btn" id="saveImage" title="Salvar imagem">💾</button>
            <div class="nzr-save-options">
              <button class="nzr-save-option" data-type="full" title="Capturar tela inteira">🖥️ Tela Inteira</button>
              <button class="nzr-save-option" data-type="selection" title="Capturar área selecionada">✂️ Seleção</button>
            </div>
          </div>
          <button class="nzr-tool-btn" id="exitAnnotation" title="Sair (ESC)">✕</button>
        </div>
      `;
      
      return toolbar;
    }

    function setupToolbarEvents(toolbar) {
      // Tool selection
      toolbar.querySelectorAll('[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
          toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          ANNOTATION.currentTool = btn.dataset.tool;
          ANNOTATION.canvas.className = `nzr-annotation-canvas ${ANNOTATION.currentTool}`;
          
          // Hide any open text input when switching tools
          if (ANNOTATION.currentTextInput) {
            commitTextInput();
          }
          
          // Make elements moveable when move tool is selected
          if (ANNOTATION.currentTool === 'move') {
            console.log('Move tool selected, making elements moveable');
            makeElementsMoveable();
          }
        });
      });
      
      // Color, width and font size controls
      const strokeColorInput = toolbar.querySelector('#strokeColor');
      const strokeWidthInput = toolbar.querySelector('#strokeWidth');
      const fontSizeInput = toolbar.querySelector('#fontSize');
      
      strokeColorInput.addEventListener('change', (e) => {
        ANNOTATION.strokeColor = e.target.value;
        ANNOTATION.fillColor = e.target.value + '33'; // Add transparency
      });
      
      strokeWidthInput.addEventListener('input', (e) => {
        ANNOTATION.strokeWidth = parseInt(e.target.value);
      });
      
      fontSizeInput.addEventListener('change', (e) => {
        ANNOTATION.fontSize = parseInt(e.target.value);
      });
      
      // Prevent keyboard events from propagating when using font size dropdown
      fontSizeInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
      });
      
      fontSizeInput.addEventListener('keyup', (e) => {
        e.stopPropagation();
      });
      
      // Action buttons
      toolbar.querySelector('#clearAll').addEventListener('click', clearCanvas);
      toolbar.querySelector('#exitAnnotation').addEventListener('click', stopAnnotationMode);
      toolbar.querySelector('#helpButton').addEventListener('click', showHelpModal);
      
      // Save options
      toolbar.querySelectorAll('.nzr-save-option').forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const type = e.target.dataset.type;
          if (type === 'full') {
            saveAnnotatedImage();
          } else if (type === 'selection') {
            saveSelectionImage();
          }
        });
      });
    }

    function setupCanvasEvents(canvas) {
      let tempCanvas = null;
      let tempCtx = null;
      
      function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
      }
      
      canvas.addEventListener('mousedown', (e) => {
        // Skip canvas handling when move tool is active - elements handle their own events
        if (ANNOTATION.currentTool === 'move') {
          console.log('Move tool active - canvas ignoring mousedown');
          return;
        }
        
        e.preventDefault();
        
        if (ANNOTATION.currentTool === 'text') {
          // Handle text tool - create text input
          const pos = getMousePos(e);
          createTextInput(pos.x, pos.y);
          return;
        }
        
        // Move tool is now handled by individual element event listeners
        
        ANNOTATION.isDrawing = true;
        const pos = getMousePos(e);
        ANNOTATION.startX = pos.x;
        ANNOTATION.startY = pos.y;
        ANNOTATION.lastX = pos.x;
        ANNOTATION.lastY = pos.y;
        
        if (ANNOTATION.currentTool === 'brush') {
          ANNOTATION.ctx.beginPath();
          ANNOTATION.ctx.moveTo(pos.x, pos.y);
        } else if (['rectangle', 'circle', 'arrow', 'line'].includes(ANNOTATION.currentTool)) {
          // Create temporary canvas for shape preview
          if (!tempCanvas) {
            tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            tempCanvas.style.position = 'absolute';
            tempCanvas.style.top = '0';
            tempCanvas.style.left = '0';
            tempCanvas.style.pointerEvents = 'none';
            canvas.parentNode.appendChild(tempCanvas);
            tempCtx = tempCanvas.getContext('2d');
          }
        }
      });
      
      canvas.addEventListener('mousemove', (e) => {
        // Skip canvas handling when move tool is active
        if (ANNOTATION.currentTool === 'move') {
          return;
        }
        
        const pos = getMousePos(e);
        
        if (!ANNOTATION.isDrawing) return;
        
        if (ANNOTATION.currentTool === 'brush') {
          ANNOTATION.ctx.strokeStyle = ANNOTATION.strokeColor;
          ANNOTATION.ctx.lineWidth = ANNOTATION.strokeWidth;
          ANNOTATION.ctx.lineTo(pos.x, pos.y);
          ANNOTATION.ctx.stroke();
          ANNOTATION.ctx.beginPath();
          ANNOTATION.ctx.moveTo(pos.x, pos.y);
        } else if (ANNOTATION.currentTool === 'select') {
          drawSelectionPreview(ANNOTATION.startX, ANNOTATION.startY, pos.x, pos.y);
        } else if (tempCtx) {
          // Clear temp canvas and draw shape preview
          tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
          drawShapePreview(tempCtx, ANNOTATION.startX, ANNOTATION.startY, pos.x, pos.y);
        }
      });
      
      canvas.addEventListener('mouseup', (e) => {
        // Skip canvas handling when move tool is active
        if (ANNOTATION.currentTool === 'move') {
          return;
        }
        
        if (!ANNOTATION.isDrawing) return;
        ANNOTATION.isDrawing = false;
        
        const pos = getMousePos(e);
        
        if (ANNOTATION.currentTool === 'select') {
          createSelectionArea(ANNOTATION.startX, ANNOTATION.startY, pos.x, pos.y);
        } else if (['rectangle', 'circle', 'arrow', 'line'].includes(ANNOTATION.currentTool)) {
          // Draw final shape on main canvas
          drawShape(ANNOTATION.ctx, ANNOTATION.startX, ANNOTATION.startY, pos.x, pos.y);
          // Clean up temp canvas
          if (tempCanvas) {
            tempCanvas.remove();
            tempCanvas = null;
            tempCtx = null;
          }
        }
      });
    }

    function getElementAtPosition(x, y) {
      console.log('getElementAtPosition called with:', x, y);
      console.log('Text elements count:', ANNOTATION.textElements.length);
      console.log('Selection elements count:', ANNOTATION.selections.length);
      console.log('Shape elements count:', ANNOTATION.shapeElements.length);
      
      // Check text elements
      for (let i = 0; i < ANNOTATION.textElements.length; i++) {
        const textEl = ANNOTATION.textElements[i];
        if (!textEl || !document.contains(textEl)) continue;
        
        const rect = textEl.getBoundingClientRect();
        const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
        
        const elX = rect.left - overlayRect.left;
        const elY = rect.top - overlayRect.top;
        const elWidth = rect.width;
        const elHeight = rect.height;
        
        console.log(`Text element ${i}:`, { elX, elY, elWidth, elHeight, rect });
        
        if (x >= elX && x <= elX + elWidth && y >= elY && y <= elY + elHeight) {
          console.log('Found text element at position');
          return textEl;
        }
      }
      
      // Check shape elements
      for (let i = 0; i < ANNOTATION.shapeElements.length; i++) {
        const shapeEl = ANNOTATION.shapeElements[i];
        if (!shapeEl || !document.contains(shapeEl)) continue;
        
        const rect = shapeEl.getBoundingClientRect();
        const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
        
        const elX = rect.left - overlayRect.left;
        const elY = rect.top - overlayRect.top;
        const elWidth = rect.width;
        const elHeight = rect.height;
        
        console.log(`Shape element ${i}:`, { elX, elY, elWidth, elHeight, rect });
        
        if (x >= elX && x <= elX + elWidth && y >= elY && y <= elY + elHeight) {
          console.log('Found shape element at position');
          return shapeEl;
        }
      }
      
      // Check selection areas
      for (let i = 0; i < ANNOTATION.selections.length; i++) {
        const selection = ANNOTATION.selections[i];
        if (!selection || !document.contains(selection)) continue;
        
        const rect = selection.getBoundingClientRect();
        const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
        
        const elX = rect.left - overlayRect.left;
        const elY = rect.top - overlayRect.top;
        const elWidth = rect.width;
        const elHeight = rect.height;
        
        console.log(`Selection element ${i}:`, { elX, elY, elWidth, elHeight, rect });
        
        if (x >= elX && x <= elX + elWidth && y >= elY && y <= elY + elHeight) {
          console.log('Found selection element at position');
          return selection;
        }
      }
      
      console.log('No element found at position');
      return null;
    }

    function startDragging(element, x, y) {
      console.log('startDragging called:', element, x, y);
      
      ANNOTATION.isDragging = true;
      ANNOTATION.draggedElement = element;
      ANNOTATION.canvas.classList.add('dragging');
      
      // Calculate offset from element position
      const currentX = parseFloat(element.style.left) || 0;
      const currentY = parseFloat(element.style.top) || 0;
      
      console.log('Current element position:', currentX, currentY);
      
      ANNOTATION.dragStartX = x;
      ANNOTATION.dragStartY = y;
      ANNOTATION.dragOffsetX = x - currentX;
      ANNOTATION.dragOffsetY = y - currentY;
      
      console.log('Drag offsets:', ANNOTATION.dragOffsetX, ANNOTATION.dragOffsetY);
      
      // Add visual feedback
      element.classList.add('dragging');
      
      // Prevent text selection during drag
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      
      console.log('Dragging started successfully');
    }

    function updateElementPosition(element, x, y) {
      console.log('updateElementPosition called:', x, y);
      
      const newX = x - ANNOTATION.dragOffsetX;
      const newY = y - ANNOTATION.dragOffsetY;
      
      console.log('Calculated new position:', newX, newY);
      
      // Constrain to overlay bounds
      const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      
      const minX = 0;
      const minY = 0;
      const maxX = overlayRect.width - elementRect.width;
      const maxY = overlayRect.height - elementRect.height;
      
      const constrainedX = Math.max(minX, Math.min(maxX, newX));
      const constrainedY = Math.max(minY, Math.min(maxY, newY));
      
      console.log('Constrained position:', constrainedX, constrainedY);
      
      element.style.left = constrainedX + 'px';
      element.style.top = constrainedY + 'px';
      
      console.log('Element position updated');
    }

    function stopDragging() {
      if (ANNOTATION.draggedElement) {
        ANNOTATION.draggedElement.classList.remove('dragging');
        ANNOTATION.draggedElement = null;
      }
      
      ANNOTATION.isDragging = false;
      ANNOTATION.canvas.classList.remove('dragging');
      
      // Restore text selection
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }

    function setupElementMovement(element) {
      if (element.dataset.movementSetup) return; // Already set up
      element.dataset.movementSetup = 'true';
      
      console.log('Setting up movement for element:', element, 'Class:', element.className);
      
      let isDragging = false;
      let offsetX, offsetY;
      
      function onMouseDown(e) {
        console.log('Mouse down on element. Current tool:', ANNOTATION.currentTool, 'Element:', element);
        if (ANNOTATION.currentTool !== 'move') return;
        
        console.log('Element mousedown - move tool active:', element);
        e.preventDefault();
        e.stopPropagation();
        
        isDragging = true;
        ANNOTATION.isDragging = true;
        ANNOTATION.draggedElement = element;
        
        const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
        
        const currentX = parseFloat(element.style.left) || 0;
        const currentY = parseFloat(element.style.top) || 0;
        
        offsetX = (e.clientX - overlayRect.left) - currentX;
        offsetY = (e.clientY - overlayRect.top) - currentY;
        
        element.classList.add('dragging');
        ANNOTATION.canvas.classList.add('dragging');
        
        console.log('Dragging started for element:', { currentX, currentY, offsetX, offsetY });
        
        // Prevent text selection
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        
        // Add global listeners only when drag starts
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }

      function onMouseMove(e) {
        if (!isDragging || ANNOTATION.currentTool !== 'move') return;
        
        console.log('Element mousemove during drag');
        e.preventDefault();
        e.stopPropagation();
        
        const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
        const newX = (e.clientX - overlayRect.left) - offsetX;
        const newY = (e.clientY - overlayRect.top) - offsetY;
        
        // Constrain to overlay bounds
        const elementRect = element.getBoundingClientRect();
        const minX = 0;
        const minY = 0;
        const maxX = overlayRect.width - elementRect.width;
        const maxY = overlayRect.height - elementRect.height;
        
        const constrainedX = Math.max(minX, Math.min(maxX, newX));
        const constrainedY = Math.max(minY, Math.min(maxY, newY));
        
        element.style.left = constrainedX + 'px';
        element.style.top = constrainedY + 'px';
        
        console.log('Element moved to:', constrainedX, constrainedY);
      }
      
      function onMouseUp(e) {
        if (!isDragging) return;
        
        console.log('Element mouseup - stopping drag');
        e.preventDefault();
        e.stopPropagation();
        
        isDragging = false;
        ANNOTATION.isDragging = false;
        ANNOTATION.draggedElement = null;
        
        element.classList.remove('dragging');
        ANNOTATION.canvas.classList.remove('dragging');
        
        // Restore text selection
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        
        // Remove global listeners when drag ends
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      
      // Add event listeners to element
      element.addEventListener('mousedown', onMouseDown);
    }

    function makeElementsMoveable() {
      console.log('Making elements moveable. Text elements:', ANNOTATION.textElements.length, 'Selections:', ANNOTATION.selections.length, 'Shapes:', ANNOTATION.shapeElements.length);
      
      // Make all existing text elements moveable
      ANNOTATION.textElements.forEach(textEl => {
        if (!textEl.classList.contains('nzr-moveable-element')) {
          textEl.classList.add('nzr-moveable-element');
          setupElementMovement(textEl);
          console.log('Added movement to text element:', textEl);
        }
      });
      
      // Make all existing selection areas moveable
      ANNOTATION.selections.forEach(selection => {
        if (!selection.classList.contains('nzr-moveable-element')) {
          selection.classList.add('nzr-moveable-element');
          setupElementMovement(selection);
          console.log('Added movement to selection:', selection);
        }
      });
      
      // Make all existing shape elements moveable
      ANNOTATION.shapeElements.forEach(shapeEl => {
        if (!shapeEl.classList.contains('nzr-moveable-element')) {
          shapeEl.classList.add('nzr-moveable-element');
          setupElementMovement(shapeEl);
          console.log('Added movement to shape element:', shapeEl);
        }
      });
    }

    function drawSelectionPreview(startX, startY, endX, endY) {
      // Remove previous selection preview
      const prev = document.querySelector('.nzr-selection-preview');
      if (prev) prev.remove();
      
      const selection = document.createElement('div');
      selection.className = 'nzr-selection-area nzr-selection-preview';
      selection.style.left = Math.min(startX, endX) + 'px';
      selection.style.top = Math.min(startY, endY) + 'px';
      selection.style.width = Math.abs(endX - startX) + 'px';
      selection.style.height = Math.abs(endY - startY) + 'px';
      
      ANNOTATION.overlay.appendChild(selection);
    }

    function createSelectionArea(startX, startY, endX, endY) {
      // Remove preview
      const preview = document.querySelector('.nzr-selection-preview');
      if (preview) preview.remove();
      
      // Create permanent selection
      const selection = document.createElement('div');
      selection.className = 'nzr-selection-area';
      selection.style.left = Math.min(startX, endX) + 'px';
      selection.style.top = Math.min(startY, endY) + 'px';
      selection.style.width = Math.abs(endX - startX) + 'px';
      selection.style.height = Math.abs(endY - startY) + 'px';
      
      // Add remove button
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '✕';
      removeBtn.style.cssText = `
        position: absolute; top: -8px; right: -8px; width: 16px; height: 16px;
        background: #ef4444; color: white; border: none; border-radius: 50%;
        font-size: 10px; cursor: pointer; z-index: 1;
      `;
      removeBtn.addEventListener('click', () => selection.remove());
      selection.appendChild(removeBtn);
      
      ANNOTATION.overlay.appendChild(selection);
      ANNOTATION.selections.push(selection);
      console.log('Created selection area, total selections:', ANNOTATION.selections.length);
      
      // Make element moveable
      selection.classList.add('nzr-moveable-element');
      setupElementMovement(selection);
      console.log('Selection area made moveable:', selection);
    }

    function drawShapePreview(ctx, startX, startY, endX, endY) {
      ctx.strokeStyle = ANNOTATION.strokeColor;
      ctx.fillStyle = ANNOTATION.fillColor;
      ctx.lineWidth = ANNOTATION.strokeWidth;
      
      const width = endX - startX;
      const height = endY - startY;
      
      switch (ANNOTATION.currentTool) {
        case 'rectangle':
          ctx.strokeRect(startX, startY, width, height);
          ctx.fillRect(startX, startY, width, height);
          break;
        case 'circle':
          const radius = Math.sqrt(width * width + height * height) / 2;
          const centerX = startX + width / 2;
          const centerY = startY + height / 2;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          break;
        case 'line':
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          break;
        case 'arrow':
          drawArrow(ctx, startX, startY, endX, endY);
          break;
      }
    }

    function drawShape(ctx, startX, startY, endX, endY) {
      // Create moveable shape element instead of drawing on canvas
      createShapeElement(ANNOTATION.currentTool, startX, startY, endX, endY);
    }
    
    function createShapeElement(shapeType, startX, startY, endX, endY) {
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      
      // Create container element
      const shapeElement = document.createElement('div');
      shapeElement.className = 'nzr-shape-element';
      shapeElement.style.left = left + 'px';
      shapeElement.style.top = top + 'px';
      shapeElement.style.width = width + 'px';
      shapeElement.style.height = height + 'px';
      shapeElement.dataset.shapeType = shapeType;
      shapeElement.dataset.originalColor = ANNOTATION.strokeColor;
      shapeElement.dataset.originalWidth = ANNOTATION.strokeWidth;
      
      // Create SVG element
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      
      // Create shape based on type
      let shapeEl;
      switch (shapeType) {
        case 'rectangle':
          shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          shapeEl.setAttribute('x', '0');
          shapeEl.setAttribute('y', '0');
          shapeEl.setAttribute('width', width);
          shapeEl.setAttribute('height', height);
          shapeEl.setAttribute('fill', 'none');
          shapeEl.setAttribute('stroke', ANNOTATION.strokeColor);
          shapeEl.setAttribute('stroke-width', ANNOTATION.strokeWidth);
          break;
          
        case 'circle':
          shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
          shapeEl.setAttribute('cx', width / 2);
          shapeEl.setAttribute('cy', height / 2);
          shapeEl.setAttribute('rx', width / 2);
          shapeEl.setAttribute('ry', height / 2);
          shapeEl.setAttribute('fill', 'none');
          shapeEl.setAttribute('stroke', ANNOTATION.strokeColor);
          shapeEl.setAttribute('stroke-width', ANNOTATION.strokeWidth);
          break;
          
        case 'line':
          shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          shapeEl.setAttribute('x1', startX > endX ? width : 0);
          shapeEl.setAttribute('y1', startY > endY ? height : 0);
          shapeEl.setAttribute('x2', startX > endX ? 0 : width);
          shapeEl.setAttribute('y2', startY > endY ? 0 : height);
          shapeEl.setAttribute('stroke', ANNOTATION.strokeColor);
          shapeEl.setAttribute('stroke-width', ANNOTATION.strokeWidth);
          break;
          
        case 'arrow':
          const arrowPath = createArrowPath(width, height, startX > endX, startY > endY);
          shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          shapeEl.setAttribute('d', arrowPath);
          shapeEl.setAttribute('fill', 'none');
          shapeEl.setAttribute('stroke', ANNOTATION.strokeColor);
          shapeEl.setAttribute('stroke-width', ANNOTATION.strokeWidth);
          shapeEl.setAttribute('stroke-linejoin', 'round');
          shapeEl.setAttribute('stroke-linecap', 'round');
          break;
      }
      
      if (shapeEl) {
        svg.appendChild(shapeEl);
      }
      
      // Add remove button
      const removeBtn = document.createElement('div');
      removeBtn.innerHTML = '×';
      removeBtn.className = 'nzr-remove-btn';
      removeBtn.title = 'Remover forma';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = ANNOTATION.shapeElements.indexOf(shapeElement);
        if (index > -1) {
          ANNOTATION.shapeElements.splice(index, 1);
        }
        shapeElement.remove();
      });
      
      shapeElement.appendChild(svg);
      shapeElement.appendChild(removeBtn);
      
      ANNOTATION.overlay.appendChild(shapeElement);
      ANNOTATION.shapeElements.push(shapeElement);
      
      // Make element moveable
      shapeElement.classList.add('nzr-moveable-element');
      setupElementMovement(shapeElement);
      
      console.log('Created shape element:', shapeType, 'at', left, top, 'size', width, 'x', height);
    }
    
    function createArrowPath(width, height, reverseX, reverseY) {
      const headLength = Math.min(15, Math.min(width, height) * 0.3);
      
      let startX = reverseX ? width : 0;
      let startY = reverseY ? height : 0;
      let endX = reverseX ? 0 : width;
      let endY = reverseY ? 0 : height;
      
      const angle = Math.atan2(endY - startY, endX - startX);
      
      // Arrowhead points
      const headX1 = endX - headLength * Math.cos(angle - Math.PI / 6);
      const headY1 = endY - headLength * Math.sin(angle - Math.PI / 6);
      const headX2 = endX - headLength * Math.cos(angle + Math.PI / 6);
      const headY2 = endY - headLength * Math.sin(angle + Math.PI / 6);
      
      return `M ${startX} ${startY} L ${endX} ${endY} M ${endX} ${endY} L ${headX1} ${headY1} M ${endX} ${endY} L ${headX2} ${headY2}`;
    }

    function drawArrow(ctx, fromX, fromY, toX, toY) {
      const headLength = 15;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
      
      // Draw arrowhead
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    function clearCanvas() {
      ANNOTATION.ctx.clearRect(0, 0, ANNOTATION.canvas.width, ANNOTATION.canvas.height);
      
      // Clear selections
      ANNOTATION.selections.forEach(sel => sel.remove());
      ANNOTATION.selections = [];
      
      // Clear text elements
      ANNOTATION.textElements.forEach(textEl => textEl.remove());
      ANNOTATION.textElements = [];
      
      // Clear shape elements
      ANNOTATION.shapeElements.forEach(shapeEl => shapeEl.remove());
      ANNOTATION.shapeElements = [];
      
      // Remove any active text input
      if (ANNOTATION.currentTextInput) {
        ANNOTATION.currentTextInput.remove();
        ANNOTATION.currentTextInput = null;
      }
      
      // Stop any dragging in progress
      if (ANNOTATION.isDragging) {
        stopDragging();
      }
      
      showMessage('Canvas limpo');
    }

    function createTextInput(x, y) {
      // Remove any existing text input
      if (ANNOTATION.currentTextInput) {
        commitTextInput();
      }
      
      const textInput = document.createElement('input');
      textInput.className = 'nzr-text-input';
      textInput.type = 'text';
      textInput.placeholder = 'Digite o texto...';
      textInput.style.left = x + 'px';
      textInput.style.top = y + 'px';
      textInput.style.color = ANNOTATION.strokeColor;
      textInput.style.fontSize = ANNOTATION.fontSize + 'px';
      
      ANNOTATION.overlay.appendChild(textInput);
      ANNOTATION.currentTextInput = textInput;
      
      // Focus and select all text
      setTimeout(() => {
        textInput.focus();
        textInput.select();
      }, 50);
      
      // Handle Enter key to commit text
      textInput.addEventListener('keydown', (e) => {
        // Stop propagation to prevent annotation shortcuts from being triggered
        e.stopPropagation();
        
        if (e.key === 'Enter') {
          e.preventDefault();
          commitTextInput();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelTextInput();
        }
      });
      
      // Also prevent keyup and keypress events from propagating
      textInput.addEventListener('keyup', (e) => {
        e.stopPropagation();
      });
      
      textInput.addEventListener('keypress', (e) => {
        e.stopPropagation();
      });
      
      // Prevent input events from propagating
      textInput.addEventListener('input', (e) => {
        e.stopPropagation();
      });
      
      // Auto-commit when losing focus
      textInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (ANNOTATION.currentTextInput === textInput) {
            commitTextInput();
          }
        }, 100);
      });
    }

    function commitTextInput() {
      if (!ANNOTATION.currentTextInput) return;
      
      const text = ANNOTATION.currentTextInput.value.trim();
      if (text) {
        const x = parseInt(ANNOTATION.currentTextInput.style.left);
        const y = parseInt(ANNOTATION.currentTextInput.style.top);
        
        // Create permanent text element
        const textElement = document.createElement('div');
        textElement.className = 'nzr-text-element';
        textElement.textContent = text;
        textElement.style.left = x + 'px';
        textElement.style.top = y + 'px';
        textElement.style.color = ANNOTATION.strokeColor;
        textElement.style.fontSize = ANNOTATION.fontSize + 'px';
        textElement.dataset.originalFontSize = ANNOTATION.fontSize;
        
        // Add double-click to edit functionality
        textElement.addEventListener('dblclick', (e) => {
          e.preventDefault();
          editTextElement(textElement);
        });
        
        ANNOTATION.overlay.appendChild(textElement);
        ANNOTATION.textElements.push(textElement);
        
        // Make element moveable
        textElement.classList.add('nzr-moveable-element');
        setupElementMovement(textElement);
      }
      
      // Remove input
      ANNOTATION.currentTextInput.remove();
      ANNOTATION.currentTextInput = null;
    }

    function cancelTextInput() {
      if (ANNOTATION.currentTextInput) {
        ANNOTATION.currentTextInput.remove();
        ANNOTATION.currentTextInput = null;
      }
    }

    function editTextElement(textElement) {
      const rect = textElement.getBoundingClientRect();
      const overlayRect = ANNOTATION.overlay.getBoundingClientRect();
      
      const x = rect.left - overlayRect.left;
      const y = rect.top - overlayRect.top;
      
      // Create text input with current text
      const textInput = document.createElement('input');
      textInput.className = 'nzr-text-input';
      textInput.type = 'text';
      textInput.value = textElement.textContent;
      textInput.style.left = x + 'px';
      textInput.style.top = y + 'px';
      textInput.style.color = textElement.style.color;
      textInput.style.fontSize = textElement.style.fontSize;
      
      // Remove old text element
      const index = ANNOTATION.textElements.indexOf(textElement);
      if (index > -1) {
        ANNOTATION.textElements.splice(index, 1);
      }
      textElement.remove();
      
      ANNOTATION.overlay.appendChild(textInput);
      ANNOTATION.currentTextInput = textInput;
      
      // Focus and select all text
      setTimeout(() => {
        textInput.focus();
        textInput.select();
      }, 50);
      
      // Handle Enter key to commit text
      textInput.addEventListener('keydown', (e) => {
        // Stop propagation to prevent annotation shortcuts from being triggered
        e.stopPropagation();
        
        if (e.key === 'Enter') {
          e.preventDefault();
          commitTextInput();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelTextInput();
        }
      });
      
      // Also prevent keyup and keypress events from propagating
      textInput.addEventListener('keyup', (e) => {
        e.stopPropagation();
      });
      
      textInput.addEventListener('keypress', (e) => {
        e.stopPropagation();
      });
      
      // Prevent input events from propagating
      textInput.addEventListener('input', (e) => {
        e.stopPropagation();
      });
      
      // Auto-commit when losing focus
      textInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (ANNOTATION.currentTextInput === textInput) {
            commitTextInput();
          }
        }, 100);
      });
    }

    async function saveSelectionImage() {
      try {
        // Check if there are any selection areas
        if (ANNOTATION.selections.length === 0) {
          showEnhancedMessage('⚠️ Primeiro crie uma seleção na tela', 'warning');
          return;
        }
        
        // Handle multiple selections by getting bounding box
        let selectionRect;
        if (ANNOTATION.selections.length === 1) {
          // Single selection
          const selection = ANNOTATION.selections[0];
          selectionRect = {
            left: parseFloat(selection.style.left),
            top: parseFloat(selection.style.top),
            width: parseFloat(selection.style.width),
            height: parseFloat(selection.style.height)
          };
        } else {
          // Multiple selections - get bounding box
          let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
          
          ANNOTATION.selections.forEach(selection => {
            const left = parseFloat(selection.style.left);
            const top = parseFloat(selection.style.top);
            const width = parseFloat(selection.style.width);
            const height = parseFloat(selection.style.height);
            
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + width);
            maxY = Math.max(maxY, top + height);
          });
          
          selectionRect = {
            left: minX,
            top: minY,
            width: maxX - minX,
            height: maxY - minY
          };
          
          showEnhancedMessage(`📦 Capturando ${ANNOTATION.selections.length} seleções`, 'info');
        }
        
        // Request screenshot from background script
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'REQUEST_VISIBLE_TAB_CAPTURE' }, resolve);
        });
        
        if (!response.ok) {
          throw new Error(response.error || 'Falha na captura');
        }
        
        // Create composite image
        const img = new Image();
        img.onload = () => {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = selectionRect.width;
          tempCanvas.height = selectionRect.height;
          const tempCtx = tempCanvas.getContext('2d');
          
          // Calculate scale factors
          const scaleX = ANNOTATION.canvas.width / window.innerWidth;
          const scaleY = ANNOTATION.canvas.height / window.innerHeight;
          
          // Draw cropped screenshot
          tempCtx.drawImage(
            img,
            selectionRect.left * scaleX,
            selectionRect.top * scaleY,
            selectionRect.width * scaleX,
            selectionRect.height * scaleY,
            0,
            0,
            selectionRect.width,
            selectionRect.height
          );
          
          // Draw annotations (cropped to selection)
          tempCtx.drawImage(
            ANNOTATION.canvas,
            selectionRect.left,
            selectionRect.top,
            selectionRect.width,
            selectionRect.height,
            0,
            0,
            selectionRect.width,
            selectionRect.height
          );
          
          // Convert to blob and download
          tempCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `selection-${Date.now()}.png`;
            link.click();
            URL.revokeObjectURL(url);
            showEnhancedMessage('✅ Seleção salva com sucesso', 'success');
          });
        };
        img.src = response.dataUrl;
        
      } catch (error) {
        console.error('Erro ao salvar seleção:', error);
        showEnhancedMessage('❌ Erro ao salvar seleção', 'error');
      }
    }

    async function saveAnnotatedImage() {
      try {
        // Request screenshot from background script
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'REQUEST_VISIBLE_TAB_CAPTURE' }, resolve);
        });
        
        if (!response.ok) {
          throw new Error(response.error || 'Falha na captura');
        }
        
        // Create composite image
        const img = new Image();
        img.onload = () => {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = ANNOTATION.canvas.width;
          tempCanvas.height = ANNOTATION.canvas.height;
          const tempCtx = tempCanvas.getContext('2d');
          
          // Draw screenshot
          tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
          
          // Draw annotations
          tempCtx.drawImage(ANNOTATION.canvas, 0, 0);
          
          // Convert to blob and download
          tempCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `annotation-${Date.now()}.png`;
            link.click();
            URL.revokeObjectURL(url);
            showEnhancedMessage('✅ Tela inteira salva com sucesso', 'success');
          });
        };
        img.src = response.dataUrl;
        
      } catch (error) {
        console.error('Erro ao salvar imagem:', error);
        showEnhancedMessage('❌ Erro ao salvar tela inteira', 'error');
      }
    }

    function startAnnotationMode() {
      if (ANNOTATION.active) return;
      
      ensureAnnotationStyles();
      
      const { overlay, canvas, ctx } = createAnnotationCanvas();
      ANNOTATION.overlay = overlay;
      ANNOTATION.canvas = canvas;
      ANNOTATION.ctx = ctx;
      ANNOTATION.active = true;
      
      ANNOTATION.toolbar = buildAnnotationToolbar();
      document.documentElement.appendChild(ANNOTATION.toolbar);
      
      setupToolbarEvents(ANNOTATION.toolbar);
      setupCanvasEvents(canvas);
      
      // Keyboard shortcuts
      document.addEventListener('keydown', annotationKeyHandler, true);
      
      showMessage('Modo de anotação ativado • Alt+Shift+N para ativar rapidamente');
    }

    function annotationKeyHandler(e) {
      if (!ANNOTATION.active) return;
      
      // Don't process shortcuts if user is typing in a text input
      if (ANNOTATION.currentTextInput && document.activeElement === ANNOTATION.currentTextInput) {
        // Only allow ESC to cancel text input
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelTextInput();
        }
        return;
      }
      
      // Don't process shortcuts if focus is on any input element or help modal is open
      const activeElement = document.activeElement;
      const helpModal = document.querySelector('#nzr-help-modal');
      
      if (helpModal || (activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.tagName === 'SELECT' ||
        activeElement.contentEditable === 'true' ||
        activeElement.classList.contains('nzr-text-input') ||
        activeElement.classList.contains('nzr-font-size')
      ))) {
        // Only allow ESC to exit annotation mode or close modal
        if (e.key === 'Escape') {
          e.preventDefault();
          if (helpModal) {
            helpModal.remove();
          } else {
            stopAnnotationMode();
          }
        }
        return;
      }
      
      switch (e.key.toLowerCase()) {
        case 'escape':
          e.preventDefault();
          stopAnnotationMode();
          break;
        case 's':
          if (!e.ctrlKey) {
            e.preventDefault();
            selectTool('select');
          }
          break;
        case 'b':
          e.preventDefault();
          selectTool('brush');
          break;
        case 'r':
          e.preventDefault();
          selectTool('rectangle');
          break;
        case 'c':
          e.preventDefault();
          selectTool('circle');
          break;
        case 'a':
          e.preventDefault();
          selectTool('arrow');
          break;
        case 'l':
          e.preventDefault();
          selectTool('line');
          break;
        case 't':
          e.preventDefault();
          selectTool('text');
          break;
        case 'm':
          e.preventDefault();
          selectTool('move');
          break;
        case 'h':
          e.preventDefault();
          showHelpModal();
          break;
      }
    }

    function selectTool(tool) {
      ANNOTATION.currentTool = tool;
      ANNOTATION.canvas.className = `nzr-annotation-canvas ${tool}`;
      ANNOTATION.toolbar.querySelectorAll('[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
      });
      
      // Make elements moveable when move tool is selected
      if (tool === 'move') {
        makeElementsMoveable();
      }
    }

    function stopAnnotationMode() {
      if (!ANNOTATION.active) return;
      
      document.removeEventListener('keydown', annotationKeyHandler, true);
      
      // Commit any pending text input
      if (ANNOTATION.currentTextInput) {
        commitTextInput();
      }
      
      if (ANNOTATION.overlay) {
        try { ANNOTATION.overlay.remove(); } catch { }
      }
      if (ANNOTATION.toolbar) {
        try { ANNOTATION.toolbar.remove(); } catch { }
      }
      
      // Close help modal if open
      const helpModal = document.querySelector('#nzr-help-modal');
      if (helpModal) {
        helpModal.remove();
      }
      
      ANNOTATION.active = false;
      ANNOTATION.canvas = null;
      ANNOTATION.ctx = null;
      ANNOTATION.overlay = null;
      ANNOTATION.toolbar = null;
      ANNOTATION.selections = [];
      ANNOTATION.textElements = [];
      ANNOTATION.shapeElements = [];
      ANNOTATION.currentTextInput = null;
      ANNOTATION.draggedElement = null;
      ANNOTATION.isDragging = false;
      
      showMessage('Modo de anotação encerrado');
    }

    function showHelpModal() {
      // Close existing modal if any
      const existingModal = document.querySelector('#nzr-help-modal');
      if (existingModal) {
        existingModal.remove();
        return;
      }
      
      const modal = document.createElement('div');
      modal.id = 'nzr-help-modal';
      modal.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: rgba(0, 0, 0, 0.8) !important;
        z-index: 2147483650 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        backdrop-filter: blur(5px) !important;
      `;
      
      const content = document.createElement('div');
      content.style.cssText = `
        background: #ffffff !important;
        border-radius: 20px !important;
        padding: 32px !important;
        max-width: 600px !important;
        max-height: 80vh !important;
        overflow-y: auto !important;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3) !important;
        font-family: system-ui, sans-serif !important;
        position: relative !important;
      `;
      
      content.innerHTML = `
        <button id="nzr-help-close" style="
          position: absolute; top: 16px; right: 16px; background: #f3f4f6;
          border: none; border-radius: 50%; width: 32px; height: 32px;
          font-size: 16px; cursor: pointer; color: #6b7280;
          display: flex; align-items: center; justify-content: center;
        ">✕</button>
        
        <h1 style="margin: 0 0 24px 0; color: #1f2937; font-size: 24px; font-weight: 700;">
          🎨 Guia de Anotação e Captura
        </h1>
        
        <div style="color: #374151; line-height: 1.6;">
          <section style="margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">🛠️ Ferramentas Disponíveis</h3>
            <div style="display: grid; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">⬚</span>
                <div>
                  <strong>Seleção Livre (S)</strong><br>
                  <small style="color: #6b7280;">Desenhe áreas retangulares para destacar conteúdo</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">🖌</span>
                <div>
                  <strong>Pincel (B)</strong><br>
                  <small style="color: #6b7280;">Desenho livre como em editores de imagem</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px; font-weight: bold;">T</span>
                <div>
                  <strong>Texto (T)</strong><br>
                  <small style="color: #6b7280;">Adicione texto em qualquer posição. Duplo-clique para editar</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">✋</span>
                <div>
                  <strong>Mover (M)</strong><br>
                  <small style="color: #6b7280;">Mova textos e seleções arrastando com o mouse</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">▭</span>
                <div>
                  <strong>Retângulo (R)</strong><br>
                  <small style="color: #6b7280;">Desenhe retângulos com preenchimento semitransparente</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">○</span>
                <div>
                  <strong>Círculo (C)</strong><br>
                  <small style="color: #6b7280;">Desenhe círculos baseados na distância entre pontos</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">→</span>
                <div>
                  <strong>Seta (A)</strong><br>
                  <small style="color: #6b7280;">Desenhe setas para indicar direções ou destacar elementos</small>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">─</span>
                <div>
                  <strong>Linha (L)</strong><br>
                  <small style="color: #6b7280;">Desenhe linhas retas simples</small>
                </div>
              </div>
            </div>
          </section>

          <section style="margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">🌐 Atalhos Globais</h3>
            <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600;">Painel de Dados:</span>
                <code style="background: #e5e7eb; padding: 4px 8px; border-radius: 4px; font-weight: 600;">Alt + Shift + D</code>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600;">Modo de Anotação:</span>
                <code style="background: #e5e7eb; padding: 4px 8px; border-radius: 4px; font-weight: 600;">Alt + Shift + N</code>
              </div>
            </div>
            
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">⌨️ Atalhos no Modo de Anotação</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-family: monospace; font-size: 13px;">
              <div><strong>ESC</strong> - Sair do modo</div>
              <div><strong>S</strong> - Seleção livre</div>
              <div><strong>B</strong> - Pincel</div>
              <div><strong>T</strong> - Texto</div>
              <div><strong>M</strong> - Mover</div>
              <div><strong>R</strong> - Retângulo</div>
              <div><strong>C</strong> - Círculo</div>
              <div><strong>A</strong> - Seta</div>
              <div><strong>L</strong> - Linha</div>
              <div><strong>H</strong> - Esta ajuda</div>
            </div>
          </section>

          <section style="margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">🎨 Personalização</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Cor:</strong> Use o seletor de cor para mudar a cor dos traços e textos</li>
              <li><strong>Espessura:</strong> Ajuste a espessura dos traços com o controle deslizante</li>
              <li><strong>Tamanho da Fonte:</strong> Escolha o tamanho da fonte para textos no dropdown (10px-64px)</li>
              <li><strong>Preenchimento:</strong> Formas como retângulos e círculos têm preenchimento automático</li>
            </ul>
          </section>

          <section style="margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">🔄 Movendo Elementos</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li>Selecione a ferramenta <strong>Mover (M)</strong> na barra de ferramentas</li>
              <li><strong>Clique e arraste</strong> qualquer texto ou área de seleção</li>
              <li>Os elementos ficam <strong>destacados</strong> quando você passa o mouse sobre eles</li>
              <li>Durante o movimento, os elementos são <strong>restringidos</strong> aos limites da tela</li>
              <li>O movimento tem <strong>feedback visual</strong> com sombras e escala aumentada</li>
            </ul>
          </section>

          <section style="margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">💡 Dicas de Uso</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li>Use <strong>Ctrl+Scroll</strong> para fazer zoom na página antes de anotar</li>
              <li><strong>Duplo-clique</strong> em textos para editá-los novamente</li>
              <li>As <strong>seleções livres</strong> têm botão X para remoção individual</li>
              <li>Use a ferramenta <strong>Mover</strong> para reposicionar elementos após criá-los</li>
              <li>O botão <strong>Limpar</strong> remove todas as anotações de uma vez</li>
              <li>O botão <strong>Salvar</strong> captura a tela com suas anotações</li>
              <li>Suas anotações ficam <strong>visíveis</strong> durante a captura</li>
            </ul>
          </section>

          <section>
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">📸 Captura de Tela Avançada</h3>
            <p style="margin: 0 0 12px 0;">
              Passe o mouse sobre o botão <strong>💾</strong> para ver as opções de captura disponíveis:
            </p>
            <div style="display: grid; gap: 12px; margin-bottom: 16px;">
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">🖥️</span>
                <div>
                  <strong>Tela Inteira</strong><br>
                  <small style="color: #6b7280;">Captura toda a página visível com todas as anotações</small>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;">
                <span style="font-size: 20px;">✂️</span>
                <div>
                  <strong>Captura por Seleção</strong><br>
                  <small style="color: #6b7280;">Captura apenas as áreas demarcadas com a ferramenta Seleção</small>
                </div>
              </div>
            </div>
            <div style="background: #dbeafe; border: 1px solid #93c5fd; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
              <strong style="color: #1e40af;">💡 Dica:</strong> 
              <span style="color: #1e3a8a;">Para captura por seleção, primeiro use a ferramenta Seleção (⬚) para marcar as áreas desejadas, depois escolha "✂️ Seleção" no menu de captura!</span>
            </div>
            <div style="background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 8px; padding: 12px;">
              <strong style="color: #0369a1;">📦 Múltiplas Seleções:</strong> 
              <span style="color: #0c4a6e;">Se você criou várias áreas de seleção, todas serão capturadas automaticamente como imagens separadas!</span>
            </div>
          </section>
        </div>
      `;
      
      modal.appendChild(content);
      document.documentElement.appendChild(modal);
      
      // Close button functionality
      content.querySelector('#nzr-help-close').addEventListener('click', () => {
        modal.remove();
      });
      
      // Close on outside click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
      
      // Close on ESC key
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          modal.remove();
          document.removeEventListener('keydown', escHandler, true);
        }
      };
      document.addEventListener('keydown', escHandler, true);
    }


  // Extend message handler for annotation mode
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'START_ANNOTATION_MODE') {
      console.log('🎯 Content script recebeu START_ANNOTATION_MODE');
      startAnnotationMode();
      sendResponse?.({ ok: true });
      return true;
    }
    if (msg && msg.type === 'STOP_ANNOTATION_MODE') {
      stopAnnotationMode();
      sendResponse?.({ ok: true });
      return true;
    }
    if (msg && msg.type === 'SHOW_HELP_MODAL') {
      showHelpModal();
      sendResponse?.({ ok: true });
      return true;
    }
  });
  
  // End of IIFE
})();