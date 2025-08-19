# Contribuindo para chrome-autofill-form-extension

Obrigado por contribuir! Este guia descreve como configurar o ambiente, o fluxo de trabalho de contribuição e os padrões do projeto.

## Como começar

- **Fork** o repositório e crie seu branch a partir de `main`.
- **Nome do branch**: `feat/<escopo>-<resumo>`, `fix/<escopo>-<resumo>`, `chore/<escopo>-<resumo>`.
- **Commits**: mensagens claras, em português ou inglês. Ex.: `feat(popup): add keyboard navigation`.
- **Pull Requests**: descreva o problema, a solução, passos de teste e screenshots/GIFs quando possível.

## Setup e execução local

Este projeto é uma extensão Chrome baseada em JS/HTML/CSS vanilla, sem dependências de build.

1. Abra `chrome://extensions` no Chrome.
2. Ative o modo desenvolvedor (canto superior direito).
3. Clique em “Carregar sem compactação (Load unpacked)” e selecione a pasta do projeto.
4. Para recarregar após mudanças, clique em “Recarregar (Reload)” na extensão.

Arquivos principais:
- `manifest.json`: declara permissões, scripts e páginas.
- `contentScript.js`: lógica de injeção/auto-preenchimento.
- `background.js`: listeners de ciclo de vida/ações.
- `popup.html` + `popup.js`: UI do popup.
- `options.html` + `options.js`: configurações do usuário.
- `_locales/`: i18n.
- `test/`: páginas HTML para testes manuais locais.

## Testes manuais

Use as páginas em `test/`:
- `test.html`, `test-form.html`, `material-test.html`, `radix-tabs-test.html`.

Sugestão de checklist de validação:
- [ ] Auto-preenchimento funciona em campos simples e compostos.
- [ ] Ações do `popup` refletem corretamente no `contentScript`.
- [ ] Permissões do `manifest.json` são mínimas e suficientes.
- [ ] UI/UX do `popup.html` e `options.html` estão responsivos.
- [ ] Não há erros no Console (Background, Content e Popup).

## Empacotamento (build)

Para gerar um zip para publicação:

```bash
./build-zip.sh
```

O script coleta os arquivos necessários e cria um pacote `.zip` na raiz ou em `dist/` (se aplicável). Verifique se a versão em `manifest.json` foi atualizada antes de publicar.

## Estilo de código

- **JavaScript**: ES2015+, sem dependências externas. Prefira funções puras e modularização simples.
- **Indentação**: 2 espaços. Evite tabs.
- **Nomes**: camelCase para variáveis/funções, UPPER_SNAKE_CASE para constantes.
- **Comentários**: explique o “porquê”, não só o “o quê”.
- **DOM**: evite buscas excessivas; cache seletores quando fizer sentido.
- **Segurança**: não injete HTML não confiável; sanitize quando necessário.

## Internacionalização (i18n)

Arquivos de tradução ficam em `_locales/<locale>/messages.json`.

- Locales atuais: `pt_BR/` e `manezinho/`.
- Para adicionar um novo locale:
  1. Crie a pasta `_locales/<novo_locale>/`.
  2. Copie um `messages.json` existente como base.
  3. Traduza mantendo as chaves e o formato.
  4. Garanta que `manifest.json` contém `default_locale` apropriado.
- Ao adicionar novas chaves, atualize todos os `messages.json`.

## Padrões para PRs

Inclua no corpo do PR:
- Problema/Contexto
- Solução proposta
- Impactos no `manifest.json` (permissões, versionamento)
- Notas de i18n (novas chaves/atualizações)
- Passos de teste manual e resultados
- Screenshots/GIFs (quando aplicável)

Checklist para abrir PR:
- [ ] Testado nas páginas de `test/`.
- [ ] Verificado console de `background`, `content` e `popup` sem erros.
- [ ] Atualizado `manifest.json` (se necessário) e `README.md`.
- [ ] Traduções em `_locales/` atualizadas.
- [ ] Mudanças documentadas no PR.

## Versionamento

- Siga `major.minor.patch` no `manifest.json`.
- Bumps de versão:
  - `patch`: correções internas, sem mudanças de permissão.
  - `minor`: novas features compatíveis.
  - `major`: mudanças quebrando compatibilidade ou novas permissões amplas.

## Report de bugs e segurança

- Abra uma issue com passos de reprodução, comportamento atual e esperado.
- Para questões de segurança, evite informações sensíveis em público; ofereça um meio de contato privado se necessário.

## Código de Conduta

Seja respeitoso, colaborativo e receptivo a feedback. PRs e reviews devem focar no código e na melhoria do produto.

---

Dúvidas? Abra uma issue ou mencione no PR.
