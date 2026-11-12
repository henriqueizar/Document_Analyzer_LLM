# Privacidade e LGPD

Este documento descreve, de forma verificável, quais dados a aplicação trata, onde eles
ficam e o que (não) sai da máquina. Ele é atualizado a cada mudança que afete esses pontos.

> **Importante:** este documento descreve controles técnicos. Ele não é um parecer jurídico
> e não atesta conformidade com a LGPD (Lei nº 13.709/2018), que também depende de
> processos da organização que usa a aplicação (base legal, transparência com os titulares,
> encarregado, etc.).

## Princípio

Durante o uso, a aplicação funciona **inteiramente no computador ou servidor onde está
instalada**. Documentos, texto extraído, perguntas, respostas e dados pessoais não são
enviados a serviços externos.

A **instalação** usa a internet uma vez: pacotes npm, imagens Docker e o modelo da LLM
(`ollama pull`). Depois disso, a aplicação funciona sem internet.

## Inventário de dados

| Dado | Origem | Onde fica | Quem acessa |
| --- | --- | --- | --- |
| Arquivos enviados (PDF, imagens) | Upload do usuário | Pasta `backend/uploads/` (disco local) | Somente o dono do documento, pela rota autenticada `GET /documents/:id/file` |
| Texto extraído (OCR / camada de texto) | Processamento local | PostgreSQL local (`Document.extractedText`) | Somente o dono |
| Perguntas, respostas e explicações, com os trechos do documento usados como fonte | Usuário / LLM local | PostgreSQL local (`LlmInteraction`) | Somente o dono |
| Nome, e-mail e papel do usuário | Cadastro feito pelo administrador (ou configuração inicial) | PostgreSQL local (`User`) e cookie de sessão | O próprio usuário; o administrador vê a lista de usuários |
| Senha | Usuário | PostgreSQL local, **somente o hash scrypt com sal** (a senha nunca é armazenada) | Ninguém |

Documentos empresariais frequentemente contêm dados pessoais de terceiros (nomes, CPF,
endereços, salários). Eles ficam nos mesmos lugares acima.

## Componentes e conexões de rede

| Componente | Roda onde | Conexões externas durante o uso |
| --- | --- | --- |
| Frontend (Next.js) | Local | Nenhuma. Telemetria do Next.js desligada nos scripts (`NEXT_TELEMETRY_DISABLED=1`). |
| Backend (NestJS) | Local | Nenhuma. |
| OCR (tesseract.js) | Local, no processo do backend | Nenhuma. Os modelos de idioma vêm de `backend/por.traineddata` e `backend/eng.traineddata`; se faltarem, o OCR falha com erro em vez de baixá-los de um CDN. Os decodificadores do leitor de PDF (por exemplo, JPEG 2000) também são arquivos locais do pacote `pdfjs-dist`. |
| Leitura de PDF (pdf-parse) | Local | Nenhuma. |
| LLM (Ollama) | Local (`OLLAMA_URL`, padrão `http://localhost:11434`) | Nenhuma por parte da aplicação. |
| Banco (PostgreSQL em Docker) | Local, porta ligada só a `127.0.0.1` | Nenhuma. |
| Prisma CLI (migrações) | Local | Nenhuma, com `CHECKPOINT_DISABLE=1` no `backend/.env` (padrão do `.env.example`). |
| Login (contas locais) | Local | Nenhuma. E-mail e senha são verificados pelo backend; não há provedor de identidade externo. |

Fora do escopo da aplicação: o próprio sistema operacional, o Docker Desktop e o app do
Ollama podem verificar atualizações por conta própria.

## Medidas implementadas

- Processamento de documentos (OCR e LLM) 100% local.
- Login local: senhas com hash scrypt e sal aleatório; bloqueio de 15 minutos após
  5 tentativas erradas; sessão de 12 horas; conta removida ou com papel alterado perde o
  acesso imediatamente.
- Autenticação em todas as rotas de documentos; cada usuário só acessa os próprios
  documentos (um documento de outra pessoa responde 404, igual a um inexistente).
- Arquivos enviados não são públicos (não há servidor de arquivos estático).
- Exclusão de documentos (direito de eliminação, art. 18): o botão "Delete" apaga o
  arquivo do disco, o texto extraído e todas as explicações, perguntas e respostas
  (inclusive os trechos guardados como fonte das citações). Não há cópia de segurança
  automática: o dado deixa de existir na aplicação. Backups feitos pela organização
  (do disco ou do banco) precisam seguir a mesma política.
- CORS restrito à origem do frontend.
- Banco e LLM acessíveis apenas em `127.0.0.1` no `docker-compose.yml`.
- Respostas da LLM restritas ao conteúdo do documento, com citação de página e checagem
  automática (reduz o risco de informação incorreta sobre titulares).

## O que ainda falta

- Exclusão de contas de usuário (com seus documentos) pelo administrador.
- Registro de auditoria: quem acessou ou perguntou o quê (registro das operações, art. 37).
- Permissões por equipe (acesso mínimo necessário).
- Política de retenção e detecção de dados sensíveis.
- A tela de configuração inicial fica aberta até o administrador ser criado: faça a
  configuração logo após instalar, antes de expor a aplicação na rede.
- Para uso em produção: criptografia em repouso (disco / banco), senhas fortes no banco,
  HTTPS na rede interna e backups.

## Como verificar

A tela **Privacy** da aplicação (mostrada após o primeiro login e acessível pelo rodapé)
explica estas três formas:

1. **Pedir a uma IA que audite o código.** A tela traz um texto pronto (em português e
   em inglês) que pede à IA para *procurar* vazamentos — rede, telemetria, autenticação
   externa, CDNs, downloads — e não para confirmar que não há nenhum. Uma IA só lê o
   código do repositório e pode errar; por isso as verificações abaixo.
2. **Usar sem internet:** desligue a rede e use a aplicação normalmente (login, upload,
   OCR, perguntas). Opcionalmente, observe as conexões com um firewall de saída (por
   exemplo, LuLu no macOS).
3. **Verificação automática:** `cd backend && npm run verify:offline` (requer Docker).
   O teste de ponta a ponta (login, upload, OCR real de imagem e de PDF, isolamento entre
   usuários) roda num container ligado a uma rede Docker `internal`, sem rota para a
   internet. Antes, o script prova que o container não alcança nenhum host externo (DNS,
   TCP e HTTPS bloqueados); se alcançar, a verificação é abortada. A LLM é simulada nesse
   teste; no uso real ela é o Ollama local (`OLLAMA_URL`).
