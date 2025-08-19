# NZR DevTool - Chrome Extension

Extensão Chrome completa para preenchimento automático de formulários e anotação de páginas web. Inclui geração de dados fictícios, IA para preenchimento inteligente e ferramentas avançadas de anotação e screenshot.

## 🆕 Novidades da v0.4.0
- **📌 Fixar Painel (Pin):** opção para manter o painel lateral fixo sem sobrepor o conteúdo da página. Aplica deslocamento no layout e lembra sua preferência.
- **📮 CEP:** novo gerador de CEP no formato `00000-000`, disponível no painel, no menu de contexto e com opção para habilitar/desabilitar nas configurações.

## 🆕 Novidades da v0.3.0
- **🎨 Sistema de Anotação Completo:** Ferramentas de desenho, texto, formas geométricas e seleção de áreas
- **📸 Screenshot Avançado:** Captura de tela inteira ou apenas áreas selecionadas
- **🖱️ Elementos Movíveis:** Todas as anotações, textos e formas podem ser reposicionadas
- **🎯 Interface Moderna:** Design glassmorphism com animações e gradientes
- **📋 Cópia Robusta:** Sistema de clipboard com fallback para máxima compatibilidade
- **⌨️ Atalhos de Teclado:** `Alt+Shift+D` (dados) e `Alt+Shift+N` (anotação)
- **🔧 Páginas Redesenhadas:** Popup, configurações e política de privacidade com design moderno

## 🎯 Funcionalidades Principais

### 📊 Painel de Dados
- **Geração de Dados Fictícios:** Nome, email, CPF, CNPJ, telefone, CEP, UUID
- **Interface Card-Based:** Design moderno com animações e hover effects
- **Cópia Inteligente:** Clique nos valores para copiar ou preencher campos automaticamente
- **Regeneração Rápida:** Botão para gerar novos dados instantaneamente
- **Personalização:** Configure quais tipos de dados exibir nas opções
- **Fixar Painel (Pin):** Mantenha o painel aberto sem cobrir o conteúdo; preferência persistida.

### ✏️ Sistema de Anotação
- **🖌️ Ferramentas de Desenho:**
  - **⬚ Seleção Livre:** Crie áreas de seleção para captura
  - **🖌️ Pincel:** Desenho livre com espessura configurável
  - **T Texto:** Adicione texto com tamanhos de 10px a 64px
  - **✋ Movimento:** Mova qualquer elemento criado
  - **▭ Retângulo:** Formas geométricas precisas
  - **○ Círculo:** Círculos e elipses
  - **→ Seta:** Setas direcionais
  - **─ Linha:** Linhas retas

- **🎨 Personalização:**
  - Seletor de cores para traços
  - Controle de espessura (1-20px)
  - Tamanhos de fonte flexíveis
  - Preview em tempo real

- **📸 Captura de Tela:**
  - **🖥️ Tela Inteira:** Captura toda a página com anotações
  - **✂️ Seleção:** Captura apenas áreas selecionadas
  - **📦 Múltiplas Seleções:** Suporte automático para várias áreas
  - **💾 Download Automático:** Salva como PNG com timestamp

### 🤖 Preenchimento Inteligente com IA
- **Preenchimento Contextual:** Usa OpenAI ou Gemini para entender formulários
- **Ampla Cobertura:** Input, textarea, select, checkbox, radio, ARIA combobox
- **Navegação Automática:** Detecta e navega por formulários multi-etapas
- **Múltiplas Formas de Uso:**
  - Popup com 1 clique
  - Atalho `Alt+Shift+D`
  - Menu de contexto (clique direito)
- **Segurança:** Ignora campos de senha e arquivos

### ⚙️ Configurações Avançadas
- **Interface Moderna:** Design glassmorphism com animações
- **Configuração de IA:** OpenAI ou Gemini com chaves personalizadas
- **Tipos de Dados:** Configure quais dados aparecem no painel
- **Internacionalização:** Suporte a múltiplos idiomas
- **Política de Privacidade:** Documento completo e navegável

## 🚀 Instalação

### Modo Desenvolvedor
1. Acesse `chrome://extensions` e habilite o "Modo do desenvolvedor"
2. Clique em "Carregar sem compactação" e selecione a pasta do projeto
3. Opcional: Ative "Permitir acesso a URLs de arquivos" para testar localmente

### Chrome Web Store
🔜 Em breve disponível na Chrome Web Store

## 📖 Como Usar

### 📊 Painel de Dados
1. **Ativação:**
   - Clique no ícone da extensão → "Painel de Dados"
   - Ou use o atalho `Alt+Shift+D`
2. **Uso:**
   - Clique nos valores para copiar automaticamente
   - Use os botões de cópia (📋) para ações específicas
   - Regenere dados com o botão ↻

### ✏️ Sistema de Anotação
1. **Ativação:**
   - Clique no ícone da extensão → "Anotar e Capturar Tela"
   - Ou use o atalho `Alt+Shift+N`
2. **Ferramentas:**
   - **S** - Seleção livre
   - **B** - Pincel para desenho
   - **T** - Adicionar texto
   - **M** - Mover elementos
   - **R** - Retângulo
   - **C** - Círculo
   - **A** - Seta
   - **L** - Linha
3. **Captura:**
   - Hover no ícone 💾
   - Escolha "🖥️ Tela Inteira" ou "✂️ Seleção"

### 🤖 IA para Formulários
1. **Configuração:**
   - Acesse as configurações da extensão
   - Configure OpenAI ou Gemini com sua chave de API
2. **Uso:**
   - **Tudo:** `Alt+Shift+D` ou popup
   - **Campo específico:** Clique direito → "Preencher campo"

## ⌨️ Atalhos de Teclado

| Atalho | Função |
|--------|--------|
| `Alt+Shift+D` | Painel de Dados |
| `Alt+Shift+N` | Modo de Anotação |
| `ESC` | Sair do modo anotação |
| `H` | Ajuda (no modo anotação) |

### No Modo de Anotação:
| Tecla | Ferramenta |
|-------|------------|
| `S` | Seleção |
| `B` | Pincel |
| `T` | Texto |
| `M` | Mover |
| `R` | Retângulo |
| `C` | Círculo |
| `A` | Seta |
| `L` | Linha |

## 🏗️ Arquitetura

```
📁 chrome-autofill-form-extension/
├── 📄 manifest.json          # Configuração Manifest V3
├── 📄 background.js           # Service Worker
├── 📄 contentScript.js        # Script de conteúdo principal
├── 📄 popup.html/js          # Interface do popup
├── 📄 options.html/js        # Página de configurações
├── 📄 privacy.html           # Política de privacidade
├── 📁 icons/                 # Ícones da extensão
├── 📁 _locales/              # Arquivos de internacionalização
├── 📁 test/                  # Páginas de teste
└── 📁 dist/                  # Builds de distribuição
```

## 🔧 Desenvolvimento

### Build para Distribuição
```bash
./build-zip.sh
```
Gera `dist/nzr-devtool-vX.X.X.zip` pronto para upload.

### Servidor de Teste Local
```bash
python3 -m http.server 5173
# Acesse: http://localhost:5173/test/
```

### Estrutura de Testes
- `test/simple-form.html` - Formulário básico
- `test/complex-form.html` - Formulário avançado
- `test/react-form.html` - Teste com React/Radix

## 🔒 Privacidade e Segurança

- ✅ Processamento local de dados
- ✅ APIs de IA chamadas diretamente do navegador
- ✅ Chaves de API armazenadas localmente
- ✅ Nenhum dado enviado para servidores terceiros
- ✅ Campos sensíveis (senha, arquivo) são ignorados
- ✅ Código fonte aberto e auditável

## ⚡ Performance

- 🚀 Lightweight: ~100KB total
- 🔄 Lazy loading de componentes
- 💾 Cache inteligente de configurações
- 🎯 Injeção seletiva de scripts
- ⚡ Fallbacks para máxima compatibilidade

## 🐛 Limitações Conhecidas

- IA pode ser imprecisa em campos ambíguos
- Formulários muito complexos podem precisar ajustes manuais
- Páginas com CSP restritivo podem limitar funcionalidades
- Screenshots limitados à área visível da tela

## 🗺️ Roadmap

### v0.4.0 (Planejado)
- [ ] Perfis de usuário (pessoal/corporativo)
- [ ] Templates de anotação salvos
- [ ] Exportação em múltiplos formatos
- [ ] Modo colaborativo para anotações

### v0.5.0 (Futuro)
- [ ] Aprendizado incremental da IA
- [ ] Suporte a mais provedores de IA
- [ ] Integração com ferramentas de produtividade
- [ ] API pública para desenvolvedores

## 🤝 Contribuição

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 📞 Suporte

- 🐛 **Issues:** [GitHub Issues](https://github.com/seu-usuario/chrome-autofill-form-extension/issues)
- 💬 **Discussões:** [GitHub Discussions](https://github.com/seu-usuario/chrome-autofill-form-extension/discussions)
- 📧 **Email:** Atualize com seu email de contato

---

Feito com ❤️ para desenvolvedores que valorizam produtividade e qualidade.