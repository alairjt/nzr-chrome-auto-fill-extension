# Context Autofill AI (Chrome Extension)

Preenche automaticamente campos de formulários usando IA (OpenAI ou Gemini) com base no contexto da página. Manifest V3, com service worker, content script, popup e página de opções.

## Novidades da v0.2.1
- **Internacionalização (i18n):** Adicionado suporte ao dialeto "Manezinho" (pt-BR-sc), aplicado na UI e nas requisições à IA.
- **Preenchimento Focado:** Novo item no menu de contexto (clique direito) para preencher apenas o campo focado.
- **Build Simplificado:** Script `build-zip.sh` para empacotar a extensão em um arquivo ZIP versionado.
- **Melhorias Gerais:** O preenchimento agora ignora campos já preenchidos e a cópia de valores está mais confiável.

## Funcionalidades
- **Preenchimento Inteligente:** Detecta campos (`input`, `textarea`, `select`) e extrai rótulos, placeholders e contexto para gerar sugestões via OpenAI ou Gemini.
- **Ampla Cobertura de Campos:** Suporte para textos, e-mails, datas, selects, checkboxes, radios e combobox ARIA.
- **Navegação Automática:** Detecta e navega por abas (Tabs) para garantir o preenchimento de formulários multi-etapas.
- **Múltiplas Formas de Uso:**
  - **Popup:** Execute com 1 clique no ícone da extensão.
  - **Atalho de Teclado:** `Alt+Shift+D`.
  - **Menu de Contexto:** Clique com o botão direito em um campo para preenchê-lo individualmente.
- **Configuração Flexível:** Página de opções para configurar provedor de IA (OpenAI/Gemini), chave de API e modelo.
- **Ignora Campos Preenchidos:** Para evitar sobreescrever dados, a extensão não altera campos que já possuem valor.

## Arquitetura
- `manifest.json`: Configuração MV3, permissões e atalhos.
- `background.js`: Service worker que gerencia a comunicação com as APIs de IA.
- `contentScript.js`: Injetado nas páginas para coletar campos, extrair contexto e aplicar as sugestões recebidas.
- `popup.html`/`js`: Interface de usuário para acionamento rápido.
- `options.html`/`js`: Página de configurações da extensão.
- `_locales/`: Diretório para internacionalização (i18n).

## Instalação (modo desenvolvedor)
1. Acesse `chrome://extensions` e habilite o "Modo do desenvolvedor".
2. Clique em "Carregar sem compactação" e selecione a pasta do projeto.
3. Opcional: Na página de detalhes da extensão, ative "Permitir acesso a URLs de arquivos" para testar em arquivos locais (`file://`).

## Uso
1. **Configure a IA:** Abra as opções da extensão, escolha o provedor (OpenAI ou Gemini), insira sua chave de API e salve.
2. **Abra um formulário:** Navegue até uma página com um formulário.
3. **Preencha:**
   - **Tudo:** Clique no ícone da extensão e em "Preencher Agora" ou use o atalho `Alt+Shift+D`.
   - **Apenas um campo:** Clique com o botão direito no campo desejado e selecione "Preencher campo (NZR DevTool)".

## Empacotamento para Distribuição
Para criar um arquivo `.zip` para upload na Chrome Web Store, execute o script:

```bash
./build-zip.sh
```

O arquivo será salvo na pasta `dist/` com o nome `nzr-devtool-vX.X.X.zip`, baseado na versão do `manifest.json`.

## Teste Local
As páginas de teste estão na pasta `test/`. Para executá-las, especialmente as que usam módulos (React/Radix), é recomendado um servidor local:

```bash
# Navegue até a pasta raiz do projeto
python3 -m http.server 5173
```

Abra `http://localhost:5173/test/` e escolha uma das páginas de exemplo.

## Limitações
- A IA pode não ser 100% precisa em campos ambíguos.
- Campos de senha e arquivo são ignorados por segurança.
- Heurísticas de fallback são usadas quando a IA não fornece um valor claro (ex: selecionar a primeira opção de um `select`).

## Roadmap
- Aprendizado incremental com feedback do usuário.
- Suporte a perfis (dados pessoais x corporativos).
- Melhoria na extração de contexto por campo.

## Licença
MIT