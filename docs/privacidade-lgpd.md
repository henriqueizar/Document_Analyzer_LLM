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
| Arquivos enviados (PDF, imagens) | Upload do usuário | Pasta `backend/uploads/` (disco local) | O dono do documento e, se ele compartilhar, os membros das equipes escolhidas, pela rota autenticada `GET /documents/:id/file` |
| Texto extraído (OCR / camada de texto) | Processamento local | PostgreSQL local (`Document.extractedText`) | Ninguém o vê diretamente; é usado pela LLM local para quem tem acesso ao documento |
| Explicação automática, com os trechos usados como fonte | LLM local | PostgreSQL local (`LlmInteraction`, papel `EXPLANATION`) | Quem tem acesso ao documento |
| Perguntas e respostas, com os trechos usados como fonte | Usuário / LLM local | PostgreSQL local (`LlmInteraction`, com o autor em `userId`) | **Somente quem perguntou**, também em documentos compartilhados (nem o dono vê as perguntas dos outros) |
| Equipes e membros | Administrador | PostgreSQL local (`Team`, `TeamMember`) | O administrador; cada pessoa vê as equipes de que participa |
| Compartilhamentos (documento ↔ equipe) | Dono do documento | PostgreSQL local (`DocumentShare`) | O dono; os membros veem o nome da própria equipe. No painel, o administrador vê o **nome, o dono, a data e o status** dos documentos compartilhados com cada equipe, e pode remover um compartilhamento; nunca vê o conteúdo, as perguntas ou as respostas. De documentos privados, vê só quantos cada pessoa tem |
| Nome, e-mail e papel do usuário | Cadastro feito pelo administrador (ou configuração inicial) | PostgreSQL local (`User`) e cookie de sessão | O próprio usuário; o administrador vê a lista de usuários |
| Senha | Usuário | PostgreSQL local, **somente o hash scrypt com sal** (a senha nunca é armazenada) | Ninguém |
| Registro de atividades: quem, ação, documento ou conta, data e hora (logins, tentativas falhas, uploads, aberturas, perguntas, compartilhamentos, ações do administrador) | Aplicação | PostgreSQL local (`AuditEvent`) | O administrador, no painel. **Nunca contém o texto de perguntas, respostas ou documentos**; de uma pergunta, só que ela foi feita e em que modo |

Documentos empresariais frequentemente contêm dados pessoais de terceiros (nomes, CPF,
endereços, salários). Eles ficam nos mesmos lugares acima.

## Componentes e conexões de rede

| Componente | Roda onde | Conexões externas durante o uso |
| --- | --- | --- |
| Frontend (Next.js) | Local | **Produção** (`deploy/`, ou `npm run build` + `npm start`): nenhuma, medida por `deploy/verify-egress.sh`. Telemetria desligada (`NEXT_TELEMETRY_DISABLED=1`). **Desenvolvimento** (`npm run dev`): o servidor de desenvolvimento do Next consulta `registry.npmjs.org` para saber se há versão nova; envia só o IP e a versão, nenhum dado do app, e não há como desligar. Por isso o uso real deve ser em modo produção. |
| Backend (NestJS) | Local | Nenhuma. |
| OCR (tesseract.js) | Local, no processo do backend | Nenhuma. Os modelos de idioma vêm de `backend/por.traineddata` e `backend/eng.traineddata`; se faltarem, o OCR falha com erro em vez de baixá-los de um CDN. Os decodificadores do leitor de PDF (por exemplo, JPEG 2000) também são arquivos locais do pacote `pdfjs-dist`. |
| Leitura de PDF (pdf-parse) | Local | Nenhuma. |
| LLM (Ollama) | Local (`OLLAMA_URL`, padrão `http://localhost:11434`) | Nenhuma por parte da aplicação. O backend **recusa iniciar** se a LLM ou o banco estiverem na internet, ou se o modelo for um modelo "cloud" do Ollama, a menos que `ALLOW_REMOTE_LLM=1` / `ALLOW_REMOTE_DATABASE=1` sejam definidos de propósito. Outra máquina da rede privada é aceita, com aviso no log e no painel. |
| Banco (PostgreSQL em Docker) | Local, porta ligada só a `127.0.0.1` | Nenhuma. |
| Prisma CLI (migrações) | Local | Nenhuma: `CHECKPOINT_DISABLE=1` está nos próprios scripts do `backend/package.json` e na imagem de produção, sem depender do `.env`. |
| npm | Local | O aviso de atualização do npm está desligado nos dois projetos (`.npmrc`). |
| Navegador | Máquina de cada usuário | O app desliga a tradução automática (`translate="no"`) e o corretor ortográfico (`spellcheck="false"`), que mandariam o texto da tela para serviços na nuvem. **O app não tem como bloquear recursos de IA do navegador** como "Perguntar ao Google sobre esta página", Google Lens ou Gemini no Chrome: se usados com um documento aberto, enviam o conteúdo ao Google. Oriente os usuários a não usá-los; numa empresa, o TI pode desativá-los por política do Chrome (veja abaixo). |
| Login (contas locais) | Local | Nenhuma. E-mail e senha são verificados pelo backend; não há provedor de identidade externo. |

Fora do escopo da aplicação: o próprio sistema operacional, o Docker Desktop e o app do
Ollama podem verificar atualizações por conta própria (sem dados do aplicativo).

**Recursos de IA do Chrome em empresas.** O Chrome tem políticas corporativas para
desativá-los. Os nomes mudam com as versões; em novembro de 2026 encontramos
`GenAiDefaultSettings`, `GeminiSettings` e `LensOverlaySettings` (esta em transição para
`SearchContentSharing`). Confira na [lista oficial de políticas do Chrome
Enterprise](https://chromeenterprise.google/policies/) e em `chrome://policy` antes de
aplicar.

## Medidas implementadas

- Processamento de documentos (OCR e LLM) 100% local.
- Login local: senhas com hash scrypt e sal aleatório; bloqueio de 15 minutos após
  5 tentativas erradas; sessão de 12 horas; conta removida ou com papel alterado perde o
  acesso imediatamente.
- Autenticação em todas as rotas de documentos. Cada documento é **privado por padrão**:
  só o dono o acessa, até compartilhá-lo com equipes de que participa (acesso mínimo
  necessário, art. 6º, III). Membros das equipes leem e perguntam, mas só o dono
  reprocessa, exclui ou muda o compartilhamento. Qualquer outra pessoa, inclusive o
  administrador, recebe 404, igual a um documento inexistente.
- O acesso compartilhado termina quando a pessoa sai da equipe, quando o dono desfaz o
  compartilhamento ou quando a equipe é excluída. Com o documento compartilhado de novo,
  as perguntas que a pessoa já tinha feito voltam a aparecer para ela; ao excluir o
  documento, todas são apagadas.
- Arquivos enviados não são públicos (não há servidor de arquivos estático).
- Exclusão de documentos (direito de eliminação, art. 18): o botão "Delete" apaga o
  arquivo do disco, o texto extraído e todas as explicações, perguntas e respostas
  (inclusive os trechos guardados como fonte das citações). Não há cópia de segurança
  automática: o dado deixa de existir na aplicação. Backups feitos pela organização
  (do disco ou do banco) precisam seguir a mesma política.
- Exclusão de contas (art. 18): o administrador escolhe entre apagar os documentos da
  pessoa ou transferi-los para outra, e confirma com a própria senha. As perguntas e
  respostas da pessoa são sempre apagadas, inclusive em documentos compartilhados com
  ela; a participação em equipes termina com a conta; a sessão aberta no navegador é
  encerrada na próxima ação. Não é possível excluir a própria conta nem o último
  administrador.
- Registro de atividades (art. 37), só com metadados. Abrir o mesmo documento de novo
  conta uma vez a cada 10 minutos. O registro guarda o e-mail como texto, então
  sobrevive à exclusão da conta: depois dela, o e-mail continua no histórico.
- CORS restrito à origem do frontend.
- Banco e LLM acessíveis apenas em `127.0.0.1` no `docker-compose.yml`.
- Respostas da LLM restritas ao conteúdo do documento, com citação de página e checagem
  automática (reduz o risco de informação incorreta sobre titulares).

## O que ainda falta

- Política de retenção do registro de atividades: hoje ele é mantido sem prazo. A
  organização deve definir por quanto tempo guardá-lo (inclusive o e-mail de contas
  excluídas).
- O nome de um arquivo pode, por si só, revelar dado pessoal (por exemplo,
  "advertência_joão.pdf"). O administrador vê os nomes dos documentos compartilhados com
  equipes; quem compartilha deve dar nomes neutros a arquivos sensíveis.
- O administrador controla quem está em cada equipe. Portanto, pode se incluir numa
  equipe e passar a ver os documentos compartilhados com ela. Isso é inerente a qualquer
  modelo em que alguém gerencia os grupos. Cada mudança de membros fica no registro de
  atividades, assim como cada abertura de documento; o administrador não tem como apagar
  registros pela aplicação (só com acesso direto ao banco).
- Política de retenção e detecção de dados sensíveis.
- A tela de configuração inicial fica aberta até o administrador ser criado: faça a
  configuração logo após instalar, antes de expor a aplicação na rede.
- Para uso em produção: criptografia em repouso (disco / banco), senhas fortes no banco,
  HTTPS na rede interna e backups.

## Como verificar

A tela **Privacidade** da aplicação (mostrada após o primeiro login e acessível pelo
rodapé) explica as três primeiras formas; a quarta é a mais forte:

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
   teste; no uso real ela é o Ollama local (`OLLAMA_URL`). Esse teste cobre o backend,
   não o frontend.
4. **Medição de conexões da instalação de produção:** `cd deploy && ./verify-egress.sh`
   (requer Docker). Sobe uma instalação temporária completa (proxy, interface, backend,
   banco e um substituto da LLM) e um cliente que faz o que os usuários fazem, por HTTPS:
   cria o administrador, entra, envia um PDF (OCR real), espera a explicação, pergunta e
   abre as páginas e o painel. Um monitor dentro dos processos do backend e da interface
   registra **toda tentativa** de consulta DNS e de conexão, inclusive as que falhariam
   em silêncio na rede isolada; o teste falha se alguma for para fora da instalação. Como
   controle, o script faz de propósito uma tentativa para fora e exige que o monitor a
   veja (se não visse, o monitor estaria cego). Limites: código nativo que abre conexões
   por conta própria (o motor do Prisma, que só fala com o banco) não passa pelo monitor,
   mas continua confinado pela rede isolada; o modelo real não entra no teste (exigiria
   gigabytes), só a mesma chamada HTTP que a aplicação faz a ele.
