# Instalação em produção (empresa ou uso contínuo)

Este guia é para quem vai instalar o aplicativo num servidor ou numa máquina que fica
ligada, com várias pessoas acessando pelo navegador. Para desenvolver o aplicativo, veja
o [README](../README.md) e o [guia de desenvolvimento](desenvolvimento.md).

## O que você precisa

- **Docker** com o Docker Compose v2 (Docker Desktop no Mac e no Windows; Docker Engine no
  Linux). Não é preciso instalar Node.js, PostgreSQL nem outras dependências: tudo vem
  nas imagens.
- **A LLM (Ollama)**, de uma destas formas:
  - **Servidor Linux com GPU NVIDIA** (recomendado para empresas): o Ollama roda no
    Docker. Precisa do [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
  - **Mac:** o app nativo do [Ollama](https://ollama.com), que usa a GPU da Apple (o
    Docker no Mac não usa a GPU).
  - **Só CPU:** funciona em qualquer máquina, mas as respostas ficam lentas.
- **Memória:** o modelo padrão (`qwen3:8b`, cerca de 5 GB) roda bem com 16 GB de RAM ou
  uma GPU com 8 GB ou mais. Em máquinas menores, escolha `qwen3:4b` na instalação.
- **Internet só durante a instalação**, para baixar as imagens, os pacotes e o modelo.
  Depois, o aplicativo funciona sem internet.

## Instalar

```bash
git clone https://github.com/henriqueizar/Document_Analyzer_LLM
cd Document_Analyzer_LLM/deploy
./install.sh
```

O instalador pergunta três coisas:

1. **O endereço** pelo qual as pessoas vão acessar: o nome ou o IP do servidor na rede
   (por exemplo, `documentos.empresa.local` ou `192.168.0.20`). Para usar só nesta
   máquina, deixe `localhost`.
2. **Onde a LLM roda:** `gpu`, `cpu` ou `native` (Mac).
3. **O modelo:** `qwen3:8b` por padrão.

Ele gera sozinho todas as senhas e chaves (em `deploy/.env`, legível só pelo seu usuário),
monta as imagens, baixa o modelo e sobe tudo. No fim, mostra o endereço. Na primeira
visita, crie a conta de administrador.

Instalação sem perguntas (automação):

```bash
DOLLMA_ADDRESS=documentos.empresa.local DOLLMA_LLM=gpu DOLLMA_MODEL=qwen3:8b ./install.sh
```

## O certificado (HTTPS)

O acesso é por HTTPS, com um certificado emitido por uma **autoridade certificadora local,
criada no próprio servidor**: nenhum serviço externo (como Let's Encrypt) é usado. Até que
as máquinas confiem nessa autoridade, o navegador mostra um aviso de segurança.

O instalador exporta o certificado raiz como `deploy/dollma-root.crt`. Instale-o como
"autoridade raiz confiável" nas máquinas que vão acessar. Numa empresa, o TI costuma
distribuir isso por política de grupo ou MDM.

- **macOS:** abra o arquivo, adicione-o ao chaveiro "Sistema" e, em "Confiar", escolha
  "Sempre confiar".
- **Windows:** clique duas vezes, "Instalar certificado", "Máquina local", "Autoridades de
  Certificação Raiz Confiáveis".
- **Linux:** copie para `/usr/local/share/ca-certificates/` e rode
  `sudo update-ca-certificates`. O Firefox usa um repositório próprio: Configurações,
  Certificados, Importar.

## Como fica rodando

| Parte | Onde | Internet durante o uso |
| --- | --- | --- |
| `proxy` (Caddy) | Única entrada, portas 80 e 443. `/` vai para a interface e `/backend` vai para a API | Só publica as portas para a rede local |
| `frontend` (Next.js, modo produção) | Rede interna | **Nenhuma rota** |
| `backend` (NestJS) | Rede interna | **Nenhuma rota** |
| `db` (PostgreSQL) | Rede interna | **Nenhuma rota** |
| `ollama` (modos `gpu` e `cpu`) | Rede interna | **Nenhuma rota**: o modelo é baixado durante a instalação |

A rede interna é uma rede Docker `internal`: os containers nela não têm como alcançar a
internet, mesmo que algum código tentasse. Assim, o "nada sai da máquina" é garantido pela
infraestrutura, além do código. No modo `native` (Mac), o Ollama roda fora do Docker: o
backend continua sem rota para a internet e fala com o proxy, que repassa **somente** para
o Ollama desta máquina (`Caddyfile.native-ollama`).

Tudo reinicia sozinho se um processo travar ou se a máquina reiniciar
(`restart: unless-stopped`), e o Docker confere a saúde do backend a cada 10 segundos.
Os logs ficam limitados a 50 MB por serviço.

## No dia a dia

Todos os comandos rodam dentro da pasta `deploy/`:

| Para | Comando |
| --- | --- |
| Ver se está tudo no ar | `docker compose ps` |
| Ver os logs | `docker compose logs -f` (ou `docker compose logs -f backend`) |
| Monitorar de fora | `https://<endereço>/backend/health` responde `{"status":"ok"}` (sem nenhum dado) |
| Parar e iniciar | `docker compose stop` / `docker compose start` |
| Fazer backup | `./backup.sh` |
| Restaurar um backup | `./restore.sh backups/db-<data>.sql.gz backups/uploads-<data>.tar.gz` |
| Atualizar | `./backup.sh && ./update.sh` |

A saúde detalhada (banco, LLM e modelo, fila, falhas e disco) fica no **Painel** do
administrador.

### Provar que nada sai da instalação

`./verify-egress.sh` sobe uma instalação temporária separada (não mexe na sua), faz o que
os usuários fazem e registra toda conexão que o aplicativo tenta. Falha se alguma for para
fora da instalação. Detalhes em [privacidade-lgpd.md](privacidade-lgpd.md).

### LLM em outro servidor

Se a empresa tem um servidor com GPU separado, aponte `OLLAMA_URL` em `deploy/.env` para
ele (por exemplo, `http://10.0.0.30:11434`). Endereços da rede privada são aceitos, com um
aviso permanente no painel, porque o conteúdo dos documentos passa a trafegar pela rede.
Endereços da internet, e modelos "cloud" do Ollama, fazem o backend **recusar iniciar**,
a menos que `ALLOW_REMOTE_LLM=1` seja definido de propósito (o mesmo vale para o banco, com
`ALLOW_REMOTE_DATABASE=1`).

### Backup

`./backup.sh` salva o banco e os arquivos enviados em `deploy/backups/`. Duas
recomendações:

- **Agende** o backup, por exemplo todo dia às 2h com o cron:
  `0 2 * * * cd /caminho/para/deploy && ./backup.sh`.
- **Copie `deploy/backups/` para outro disco ou outra máquina.** Um backup no mesmo disco
  não sobrevive à falha do disco. Guarde também o `deploy/.env`, que tem as chaves desta
  instalação. Os backups contêm documentos e dados pessoais: proteja-os como os dados
  originais.

### Atualizar

`./update.sh` baixa o código novo, remonta as imagens e reinicia. As migrações do banco
são aplicadas sozinhas quando o backend inicia. Faça um backup antes.

## Servidor sem internet

Monte as imagens numa máquina com internet, leve-as num arquivo e carregue no servidor:

```bash
# na máquina com internet, dentro de deploy/
docker compose build
docker save dollma-backend dollma-frontend postgres:16 caddy:2.8 ollama/ollama:latest | gzip > dollma-imagens.tar.gz
```

```bash
# no servidor, dentro de deploy/
gunzip -c dollma-imagens.tar.gz | docker load
DOLLMA_SKIP_BUILD=1 ./install.sh
```

O modelo também precisa vir de fora. Baixe-o com `ollama pull` numa máquina com internet
e copie a pasta de modelos do Ollama para o volume `dollma_ollama`.

## Capacidade

- A leitura de documentos (OCR) é feita **um documento por vez**, em segundo plano.
- As perguntas dependem do Ollama. Com várias pessoas perguntando ao mesmo tempo, elas
  entram em fila. A variável `OLLAMA_NUM_PARALLEL` do Ollama permite atender mais de uma
  por vez, com mais uso de memória da GPU.
- O aplicativo roda numa única instância (a fila e o bloqueio de tentativas de login ficam
  na memória): para crescer, use uma máquina maior, não várias máquinas. Para dezenas de
  usuários, um servidor com uma GPU deve bastar. Isso é uma estimativa, não uma medição
  de carga.

## Problemas comuns

| Sintoma | Causa provável e solução |
| --- | --- |
| Aviso de certificado no navegador | Instale `deploy/dollma-root.crt` como raiz confiável (veja "O certificado") |
| Não abre por outro nome ou IP do servidor, ou o login falha | O certificado e o login valem só para o endereço configurado. Use exatamente o de `SITE_URL` em `deploy/.env`. Para mudar, altere `SITE_ADDRESS` e `SITE_URL` e rode `docker compose up -d` |
| Painel mostra "O Ollama não responde" | Modos `gpu` e `cpu`: veja `docker compose logs ollama`. Modo `native`: confirme que o app do Ollama está aberto |
| Painel mostra "modelo não instalado" | Modos `gpu` e `cpu`: rode `./install.sh` de novo ou baixe o modelo como na instalação. Modo `native`: rode `ollama pull <modelo>` |
| Porta 80 ou 443 ocupada | Em `deploy/.env`, defina `HTTPS_PORT` (e `HTTP_PORT`) e inclua a porta no `SITE_URL` (por exemplo, `https://documentos.empresa.local:8443`); o `SITE_ADDRESS` fica sem porta. Rode `docker compose up -d` |
