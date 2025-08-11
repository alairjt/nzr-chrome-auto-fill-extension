# Context Autofill AI (Chrome Extension)

Preenche automaticamente campos de formulários usando IA (OpenAI ou Gemini) com base no contexto da página. Manifest V3, com service worker, content script, popup e página de opções.

## Funcionalidades
- Detecta campos (`input`, `textarea`, `select`) e extrai rótulos/placeholder/contexto.
- Gera sugestões via OpenAI ou Gemini.
- Preenche os campos de forma segura (dispara `input`/`change`).
- Popup para executar com 1 clique e atalho de teclado.
- Página de opções para configurar chaves e modelos.

### Cobertura de preenchimento
- Textos, e-mail, telefone, URL, números, datas e horários.
- Selects: tentamos casar por `value` ou texto; se faltar sugestão, selecionamos a primeira opção válida.
- Checkboxes e Radios: suportados (marcamos grupo com heurística quando não houver sugestão).
- ARIA Combobox: tentamos abrir e selecionar o primeiro item automaticamente.
- Abas: detectamos e navegamos por abas (ARIA `role="tab"` – inclui Radix UI – e Materialize) antes de coletar os campos para garantir o preenchimento em todas as seções.

## Arquitetura
- `manifest.json`: configuração MV3 e permissões.
- `background.js`: service worker; chama provedores IA e interpreta respostas.
- `contentScript.js`: coleta campos/contexto e aplica sugestões.
- `popup.html`/`popup.js`: UI de execução rápida.
- `options.html`/`options.js`: configuração de provedor, chave e modelo.
- `_locales/pt_BR/messages.json`: i18n básico (nome/descrição).

## Permissões
- `storage`: salvar configurações e chaves.
- `activeTab`/`tabs`: interagir com a aba ativa e enviar mensagens.
- `host_permissions`: acesso às APIs da OpenAI e Gemini; `<all_urls>` para analisar qualquer página.

## Instalação (modo desenvolvedor)
1. Acesse chrome://extensions e habilite "Modo do desenvolvedor".
2. Clique em "Carregar sem compactação" e selecione esta pasta.
3. Opcional: ative "Permitir acesso a URLs de arquivos" para testar em arquivos locais.

## Configuração de IA
1. Abra o popup ou clique em "Detalhes" > "Opções" da extensão.
2. Escolha o provedor (OpenAI ou Gemini).
3. Informe a API Key e ajuste o modelo se desejar.

Observações:
- OpenAI: endpoint Chat Completions. Modelo padrão: `gpt-4o-mini`.
- Gemini: endpoint `generateContent`. Modelo padrão: `gemini-1.5-flash`.

## Uso
- Abra uma página com formulário (ou o arquivo `test/test-form.html`).
- Clique no ícone da extensão e depois em "Preencher agora".
- Atalho de teclado: `Ctrl+Shift+Y` (Windows/Linux) ou `Command+Shift+Y` (macOS).

## Teste local com página de exemplo
Há três páginas de teste:
- Básica: `test/test-form.html`.
- Material Design (com abas, combobox ARIA, radios, checkboxes e mais selects): `test/material-test.html`.
- Radix UI Tabs (React + ESM): `test/radix-tabs-test.html`.

Opção A (file://):
- Ative "Permitir acesso a URLs de arquivos" para esta extensão em chrome://extensions.
- Abra `test/test-form.html` no navegador e use a extensão.
- Observação: a página `radix-tabs-test.html` usa módulos ESM (React/Radix via CDN) e pode não funcionar por `file://`. Prefira a Opção B (servidor) para este caso.

Opção B (servidor local):
- Com Python instalado, rode na pasta `test/`:
  ```bash
  python3 -m http.server 5173
  ```
- Abra:
  - http://localhost:5173/test-form.html
  - http://localhost:5173/material-test.html
  - http://localhost:5173/radix-tabs-test.html
  e use a extensão.

## Limitações e considerações
- A IA pode não acertar 100% em campos ambíguos; a lógica evita inventar dados sensíveis.
- Campos de senha e arquivo são ignorados por segurança. Outros campos têm heurísticas de fallback (ex.: primeira opção de select, marcar primeiro radio/checkbox).
- Para selects, tentamos casar por `value` ou texto visível; se falhar, escolhemos a primeira opção válida.

## Roadmap
- Aprendizado incremental com feedback do usuário.
- Suporte a perfis (dados pessoais corporativos x pessoais).
- Melhoria de extração de contexto por campo (antes/depois específicos).
- Internacionalização adicional (en-US).

## Licença
MIT