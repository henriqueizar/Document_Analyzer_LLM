# Changelog

## 1.0.0

Primeira versão pronta para uso pessoal e em empresas.

**Documentos e respostas**
- Leitura de PDFs e imagens: camada de texto, OCR em português e inglês, reparo de PDFs
  danificados e de fontes sem mapa de caracteres.
- Explicação automática e chat em que cada informação cita a página; a citação abre o
  trecho exato que o modelo recebeu.
- Modo estrito (só o que o documento diz) e modo de interpretação explícito, sempre
  rotulado. Checagens em código contra alucinação: páginas, números, julgamentos e
  respostas sem fonte.
- Interface, explicações e respostas em português e inglês, com tradução sob demanda.

**Pessoas e empresas**
- Contas locais, sem login externo. Equipes e compartilhamento entre setores, com chat
  próprio para cada pessoa; tudo isso fica invisível para quem usa sozinho.
- Painel do administrador: saúde do sistema, equipes e compartilhamentos, uso por pessoa,
  registro de atividades (só metadados). O administrador nunca vê o conteúdo.
- Exclusão de conta, com transferência ou exclusão dos documentos e confirmação pela senha
  do administrador.

**Instalação e operação**
- `deploy/install.sh`: instalação com um comando, HTTPS com autoridade certificadora
  local, reinício automático, backup diário automático, recuperação de senha pelo
  terminal do servidor.
- Rede isolada: banco, backend, interface e LLM sem rota para a internet. O backend recusa
  iniciar se a LLM ou o banco estiverem na internet, a menos que isso seja permitido de
  propósito.
- `deploy/verify-egress.sh`: registra toda conexão que o aplicativo tenta durante o uso e
  falha se alguma sair da instalação.

**Segurança**
- Código de instalação para criar o administrador; limites de tentativas por conta e por
  endereço; senha mínima de 10 caracteres e recusa das mais comuns; conferência do
  conteúdo real dos arquivos; política de segurança de conteúdo (CSP) e cabeçalhos de
  segurança; limite de perguntas por pessoa.

**Testado em:** macOS com Ollama nativo (pelo autor) e Linux em ambiente automatizado.
Não testado: GPU NVIDIA, Ollama em Docker com um modelo real, Windows.
