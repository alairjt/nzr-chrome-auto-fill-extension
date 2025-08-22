# Changelog

Todas as mudanças notáveis deste projeto serão documentadas aqui.

## [0.4.2]

- Correção: modo de anotação agora inicia sem ferramenta ativa por padrão, requerendo seleção manual da ferramenta desejada.
- Correção: problema onde mouse não desgrudava da ferramenta de seleção após soltar o botão, padronizando comportamento com outras ferramentas (retângulo, círculo, etc.).
- Melhoria: ferramenta de seleção agora usa canvas temporário para preview, como as demais ferramentas, garantindo comportamento consistente.

## [0.4.1]

- Dados: CEP incluído com geração no formato `00000-000` e presença no menu de contexto e nas opções de exibição do painel de dados (`options.html`).
- Painel de Dados: opção de fixar (Pin) com persistência em `chrome.storage.sync` e offset do layout via `body.nzr-panel-pinned` para não sobrepor o conteúdo; acessibilidade com `aria-pressed` no botão de pin.
- Preenchimento robusto: fallback de simulação de digitação (`simulateTyping`) quando eventos não propagam em frameworks ou máscaras; melhorias gerais de compatibilidade.
- Atalhos: envio de mensagens com fallback de injeção do content script quando necessário (`sendMessageWithFallback`) para `toggle-data-panel` e `start-annotation-mode`.
- Captura de tela: rota de background para capturar a aba visível (`REQUEST_VISIBLE_TAB_CAPTURE`) e abrir data URL em nova aba (`OPEN_DATA_URL_TAB`); melhora na precisão de recortes usando `devicePixelRatio`.
- Opções (UX): feedback visual em checkboxes, ripple no botão salvar e mensagens de sucesso/erro com animações.
- Build: script `build-zip.sh` documentado para empacotamento de release em `dist/`.
- I18n: estrutura básica em `_locales/` (`pt_BR` e `manezinho`).

## [0.4.0]

- 📌 Fixar Painel (Pin): manter o painel lateral fixo sem sobrepor o conteúdo.
- 📮 CEP: gerador de CEP no formato `00000-000` com opções de habilitar/desabilitar.

## [0.3.0]

- 🎨 Sistema de Anotação completo (desenho, texto, formas, seleção).
- 📸 Screenshot avançado (tela inteira ou áreas selecionadas).
- 🖱️ Elementos movíveis, interface moderna e cópia robusta.
- ⌨️ Atalhos de teclado e páginas redesenhadas.
