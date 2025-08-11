// contentScript.js
// Scans forms, collects contextual info, asks background AI for suggestions, and fills fields.

(function () {
    'use strict';
  
    const EXCLUDED_TYPES = new Set([
      'password', 'hidden', 'file', 'submit', 'button', 'image', 'range', 'color', 'reset'
    ]);
  
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  
    // Global registry of fields collected, keyed by fieldId, to allow
    // remount-safe targeting across tab systems that unmount inactive content (e.g., Radix Tabs)
    let FIELDS_BY_ID = new Map();
    // Fast lookup indexes by id/name for reattaching markers after remount
    let INDEX_BY_ID = new Map();   // id -> fieldId
    let INDEX_BY_NAME = new Map(); // name -> array of fieldIds
  
    // Reanexa data-cai-field-id aos elementos montados na view ativa
    function rehydrateMarkersInActiveView() {
      const nodes = [...document.querySelectorAll('input, textarea, select')];
      for (const el of nodes) {
        if (el.dataset && el.dataset.caiFieldId) continue;
        const id = el.id || '';
        const name = el.name || '';
        let fieldId = id ? INDEX_BY_ID.get(id) : undefined;
  
        if (!fieldId && name) {
          const candidates = INDEX_BY_NAME.get(name) || [];
          if (candidates.length === 1) {
            fieldId = candidates[0];
          } else if (candidates.length > 1) {
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            fieldId =
              candidates.find(fid => {
                const meta = FIELDS_BY_ID.get(fid);
                return meta && meta.tag === tag && (meta.type || '') === type;
              }) || candidates[0];
          }
        }
  
        if (fieldId) {
          try { el.dataset.caiFieldId = fieldId; } catch (_) {}
        }
      }
    }
  
    // Tab navigation helpers (handles ARIA Tabs and Materialize anchors)
    function getTabActivators() {
      const aria = [...document.querySelectorAll('[role="tab"]')];
      if (aria.length) {
        const list = document.querySelector('[role="tablist"]');
        return { kind: 'aria', items: aria, list };
      }
      const mat = [...document.querySelectorAll('ul.tabs li a[href^="#"]')];
      if (mat.length) return { kind: 'materialize', items: mat };
      return { kind: 'none', items: [] };
    }
  
    async function waitFor(cond, maxWaitMs = 1200, pollMs = 50) {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        try { if (cond()) return true; } catch (_) {}
        await sleep(pollMs);
      }
      return false;
    }
  
    async function activateTab(el) {
      try { if (el && el.focus) el.focus(); } catch (_) {}
      try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (_) {}
      try { if (el && el.click) el.click(); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (_) {}
      try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } catch (_) {}
      try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); } catch (_) {}
      // Wait until this trigger becomes active (Radix uses data-state="active" or aria-selected="true")
      const ariaCtrl = el.getAttribute('aria-controls');
      await waitFor(() => el.getAttribute('data-state') === 'active' || el.getAttribute('aria-selected') === 'true', 1000, 50);
      // Also wait a beat for content mount
      const activePanelSelector = '[role="tabpanel"][data-state="active"], .TabsContent[data-state="active"]';
      if (ariaCtrl) {
        await waitFor(() => {
          const panel = document.getElementById(ariaCtrl);
          return !!panel && (!!panel.querySelector('input, textarea, select') || panel.childElementCount >= 0);
        }, 1000, 50);
      } else {
        await waitFor(() => {
          const active = document.querySelector(activePanelSelector);
          return !!active && !!active.querySelector('input, textarea, select');
        }, 1000, 50);
      }
    }
  
    async function waitForTabs(maxWaitMs = 1500, pollMs = 150) {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const found = getTabActivators();
        if (found.kind !== 'none' && found.items.length) return found;
        await sleep(pollMs);
      }
      return getTabActivators();
    }
  
    async function openAllTabs() {
      try {
        // Wait for tabs to mount (Radix can mount late)
        const found = await waitForTabs(1500, 150);
        if (found.kind === 'none' || found.items.length === 0) return;
        for (const el of found.items) {
          try { if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
          await activateTab(el);
          await sleep(220);
        }
      } catch (_) { /* noop */ }
    }
  
    async function forEachTabView(fn) {
      const { kind, items } = getTabActivators();
      if (kind === 'none' || items.length === 0) {
        // Single view page
        await fn();
        return;
      }
      for (const el of items) {
        await activateTab(el);
        await sleep(180);
        // Reattach markers for currently mounted inputs using id/name indexes
        try { rehydrateMarkersInActiveView(); } catch (_) {}
        await fn();
      }
    }
  
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
  
    function collectFields() {
      const nodes = [...document.querySelectorAll('input, textarea, select')];
      const fields = [];
      for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && EXCLUDED_TYPES.has(type)) continue;
        const id = el.id || '';
        const name = el.name || '';
        const label = getLabel(el);
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const fieldKeyBase = [id, name, label, tag, type].filter(Boolean).join('|') || Math.random().toString(36).slice(2);
        const fieldId = 'fld_' + hash(fieldKeyBase);
        el.dataset.caiFieldId = fieldId;
  
        let options = undefined;
        if (tag === 'select') {
          options = [...el.options].map(o => ({ value: o.value, text: o.text }));
        }
  
        const field = {
          fieldId, tag, type, id, name, label, placeholder, ariaLabel,
          contextBefore: getContextText(el, 200),
          contextAfter: '', // simplified
          options,
        };
        fields.push(field);
        // keep in the global map as well
        FIELDS_BY_ID.set(fieldId, field);
      }
      return fields;
    }
  
    // Collect fields across tabbed UIs that may unmount inactive content (e.g., Radix Tabs)
    async function collectFieldsAcrossTabs() {
      const seen = new Set();
      const fields = [];
      await forEachTabView(async () => {
        const nodes = [...document.querySelectorAll('input, textarea, select')];
        for (const el of nodes) {
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();
          if (tag === 'input' && EXCLUDED_TYPES.has(type)) continue;
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
  
          if (seen.has(fieldId)) continue;
          seen.add(fieldId);
  
          const field = {
            fieldId, tag, type, id, name, label, placeholder, ariaLabel,
            contextBefore: getContextText(el, 200),
            contextAfter: '',
            options
          };
          fields.push(field);
          FIELDS_BY_ID.set(fieldId, field);
          if (id) INDEX_BY_ID.set(id, fieldId);
          if (name) {
            const arr = INDEX_BY_NAME.get(name) || [];
            arr.push(fieldId);
            INDEX_BY_NAME.set(name, arr);
          }
        }
      });
      return fields;
    }
  
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
  
    function applySuggestions(suggestions) {
      let filled = 0;
      for (const s of suggestions || []) {
        let el =
          document.querySelector(`[data-cai-field-id="${CSS.escape(s.fieldId)}"]`) ||
          [...document.querySelectorAll('[data-cai-field-id]')].find(e => e.dataset.caiFieldId === s.fieldId);
  
        // Remount-safe fallback: try by id/name if dataset marker was lost
        if (!el) {
          const meta = FIELDS_BY_ID.get(s.fieldId);
          if (meta && meta.id) el = document.getElementById(meta.id) || el;
          if (!el && meta && meta.name) {
            el =
              document.querySelector(`${meta.tag || 'input'}[name="${CSS.escape(meta.name)}"]`) ||
              document.querySelector(`[name="${CSS.escape(meta.name)}"]`);
          }
        }
        if (!el) continue;
  
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
  
        if (tag === 'select') {
          // Try to set by value or by visible text
          const byValue = [...el.options].find(o => o.value === s.value);
          const byText = [...el.options].find(o => o.text.trim().toLowerCase() === String(s.value).trim().toLowerCase());
          const target = byValue || byText;
          if (target) {
            setNativeValue(el, target.value);
            fireInputEvents(el, { input: true, change: true });
            try {
              const M = window.M;
              if (M && M.FormSelect) {
                const inst = M.FormSelect.getInstance(el);
                if (inst) inst.destroy();
                M.FormSelect.init(el);
              }
            } catch (_) {}
            filled++;
          }
          continue;
        }
  
        if (tag === 'input' && type === 'checkbox') {
          const truthy = typeof s.value === 'boolean' ? s.value : /^(true|1|on|yes|sim|checked)$/i.test(String(s.value));
          setNativeChecked(el, !!truthy);
          fireInputEvents(el, { input: false, change: true });
          filled++;
          continue;
        }
  
        if (tag === 'input' && type === 'radio') {
          let set = false;
          const groupName = el.name;
          const radios = groupName ? [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`)] : [el];
          const byVal = radios.find(r => r.value && String(r.value).toLowerCase() === String(s.value).toLowerCase());
          if (byVal) { setNativeChecked(byVal, true); fireInputEvents(byVal, { input: false, change: true }); set = true; }
          if (!set) {
            const truthy = typeof s.value === 'boolean' ? s.value : /^(true|1|on|yes|sim|checked|selecionado)$/i.test(String(s.value));
            if (truthy) { setNativeChecked(el, true); fireInputEvents(el, { input: false, change: true }); set = true; }
          }
          if (set) filled++;
          continue;
        }
  
        // Default text-like inputs and textareas
        setNativeValue(el, s.value);
        fireInputEvents(el, { input: true, change: true });
        filled++;
      }
      return filled;
    }
  
    // Apply suggestions ensuring each tab view is activated so its content is mounted
    async function applySuggestionsAcrossTabs(suggestions) {
      let total = 0;
      await forEachTabView(async () => {
        total += applySuggestions(suggestions);
      });
      return total;
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
  
    function handleComboboxesSelectFirst() {
      let filled = 0;
      const combos = [...document.querySelectorAll('[role="combobox"]')];
      for (const cb of combos) {
        try {
          cb.click();
          cb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
          const ctrlId = cb.getAttribute('aria-controls');
          let listbox = ctrlId ? document.getElementById(ctrlId) : cb.nextElementSibling;
          if (!listbox) listbox = document.querySelector('[role="listbox"]');
          if (!listbox) continue;
          const opt = listbox.querySelector('[role="option"], li, .option');
          if (opt) {
            opt.click();
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }
        } catch (_) { /* ignore */ }
      }
      return filled;
    }
  
    function fillMissingAndDefaults() {
      let filled = 0;
      const nodes = [...document.querySelectorAll('input, textarea, select')];
  
      for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
  
        // ignore excluded input types
        if (tag === 'input' && EXCLUDED_TYPES.has(type)) continue;
  
        // SELECT
        if (tag === 'select') {
          if (!el.value) {
            const opt = [...el.options].find(o => o.value !== '' && !o.disabled) || el.options[0];
            if (opt) {
              setNativeValue(el, opt.value);
              fireInputEvents(el, { input: true, change: true });
              try {
                const M = window.M;
                if (M && M.FormSelect) {
                  const inst = M.FormSelect.getInstance(el);
                  if (inst) inst.destroy();
                  M.FormSelect.init(el);
                }
              } catch (_) {}
              filled++;
            }
          }
          continue;
        }
  
        // INPUT
        if (tag === 'input') {
          if (type === 'checkbox') {
            if (!el.checked) {
              setNativeChecked(el, true);
              fireInputEvents(el, { input: false, change: true });
              filled++;
            }
            continue;
          }
          if (type === 'radio') {
            const name = el.name;
            if (name) {
              const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)];
              if (group.length && !group.some(r => r.checked)) {
                setNativeChecked(group[0], true);
                fireInputEvents(group[0], { input: false, change: true });
                filled++;
              }
            } else if (!el.checked) {
              setNativeChecked(el, true);
              fireInputEvents(el, { input: false, change: true });
              filled++;
            }
            continue;
          }
          if (type === 'date') {
            if (!el.value) {
              setNativeValue(el, todayStr());
              fireInputEvents(el, { input: true, change: true });
              filled++;
            }
            continue;
          }
          if (type === 'time') {
            if (!el.value) {
              setNativeValue(el, nowTimeStr());
              fireInputEvents(el, { input: true, change: true });
              filled++;
            }
            continue;
          }
          if (type === 'number') {
            if (!el.value) {
              const coerced = String(
                coerceNumberInRange(
                  el.value || el.getAttribute('value') || 1,
                  Number(el.min),
                  Number(el.max),
                  Number(el.step)
                )
              );
              setNativeValue(el, coerced);
              fireInputEvents(el, { input: true, change: true });
              filled++;
            }
            continue;
          }
          // default text-like input
          if (!el.value) {
            const ph = el.getAttribute('placeholder') || '';
            setNativeValue(el, ph || 'Preenchido automaticamente');
            fireInputEvents(el, { input: true, change: true });
            filled++;
          }
          continue;
        }
  
        // TEXTAREA
        if (tag === 'textarea') {
          if (!el.value) {
            const ph = el.getAttribute('placeholder') || '';
            setNativeValue(el, ph || 'Texto gerado automaticamente.');
            fireInputEvents(el, { input: true, change: true });
            filled++;
          }
          continue;
        }
      }
  
      // Try ARIA comboboxes: select first option
      filled += handleComboboxesSelectFirst();
      return filled;
    }
  
    async function fillMissingAndDefaultsAcrossTabs() {
      let total = 0;
      await forEachTabView(async () => {
        total += fillMissingAndDefaults();
      });
      return total;
    }
  
    async function runAutofill() {
      showLoadingOverlay('Preenchendo automaticamente...');
      try {
        // Reset field registry per run to avoid stale mappings
        try { FIELDS_BY_ID.clear(); } catch (_) {}
        try { INDEX_BY_ID.clear(); } catch (_) {}
        try { INDEX_BY_NAME.clear(); } catch (_) {}
  
        // Detect tabbed UIs and collect fields accordingly (with a short wait for late-mounted UIs like Radix)
        let hasTabs = !!document.querySelector('[role="tab"], ul.tabs li a[href^="#"]');
        if (!hasTabs) {
          const waited = await waitForTabs(1500, 150);
          hasTabs = waited.kind !== 'none' && waited.items.length > 0;
        }
  
        if (hasTabs) {
          // Visit each tab to ensure content is mounted at least once during collection
          await openAllTabs();
        }
  
        const fields = hasTabs ? await collectFieldsAcrossTabs() : collectFields();
        const page = getPageContext();
  
        return await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'AI_SUGGEST', fields, page }, async (resp) => {
            try {
              if (!resp || !resp.ok) {
                // If AI fails, still try to fill with defaults
                const def = hasTabs ? await fillMissingAndDefaultsAcrossTabs() : fillMissingAndDefaults();
                resolve({
                  ok: false,
                  error: (resp && resp.error) ? resp.error : 'Erro desconhecido',
                  filled: def
                });
                return;
              }
              const count = hasTabs ? await applySuggestionsAcrossTabs(resp.suggestions) : applySuggestions(resp.suggestions);
              const def = hasTabs ? await fillMissingAndDefaultsAcrossTabs() : fillMissingAndDefaults();
              resolve({ ok: true, filled: count + def });
            } finally {
              hideLoadingOverlay();
            }
          });
        });
      } catch (e) {
        const hasTabs = !!document.querySelector('[role="tab"], ul.tabs li a[href^="#"]');
        const def = hasTabs ? await fillMissingAndDefaultsAcrossTabs() : fillMissingAndDefaults();
        hideLoadingOverlay();
        return { ok: false, error: (e && e.message) ? e.message : 'Erro durante preenchimento', filled: def };
      }
    }
  
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'POPUP_AUTOFILL') {
        (async () => {
          const r = await runAutofill();
          sendResponse(r);
        })();
        return true;
      }
    });
  })();
  