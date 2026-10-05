# 🎱 BINGO

Aplicação web responsiva para sortear números de bingo, cadastrar cartelas dos participantes (por escaneamento com a câmera ou manualmente), marcar automaticamente os números sorteados em cada cartela e alertar o vencedor de acordo com os critérios configurados.

O frontend é HTML/CSS/JavaScript puro (sem etapa de build), servido por Nginx; o back-end (`api/`, Express + Prisma + PostgreSQL) cuida do login por usuário (papéis Master e Usuário), do estado de cada operador, do telão público e das regras de privacidade (LGPD).

## Funcionalidades

### Sorteio
- Botão **Sortear número**, que sorteia aleatoriamente um número dentro do intervalo configurado (sem repetir números já sorteados).
- Contador de quantos números já saíram / total do intervalo.
- Lista das últimas bolas sorteadas (quantidade configurável em Configurações, padrão 15).
- Painel visual com todos os números do intervalo, organizados nas colunas B‑I‑N‑G‑O, destacando os já sorteados.
- Marcação automática dos números sorteados em todas as cartelas ativas da partida.
- Alerta de vencedor assim que uma cartela atinge um dos critérios configurados.
- Botão **Encerrar jogo**: arquiva as cartelas da partida atual (elas não podem ser reaproveitadas em jogos futuros) e inicia uma nova partida.

### Cartelas
- **Escanear cartela**: pela câmera ou por uma foto da galeria. O app acha a grade 5×5 sozinho, corrige a perspectiva, limpa as manchas do papel e lê cada casa (OCR via [Tesseract.js](https://github.com/naptha/tesseract.js), carregado por CDN), conferindo pela faixa de cada letra (B 1–15, I 16–30...) e sem repetir números. Também lê o número da cartela impresso abaixo da grade e gira a foto sozinho se ela estiver de lado. Tudo cai numa grade editável para conferência antes de salvar.
- **Cadastro manual**: preenche a cartela sem usar a câmera.
- Cada cartela é vinculada a um nome de participante.
- Uma cartela com o mesmo conjunto de números não pode ser cadastrada duas vezes na mesma partida, nem reaproveitada depois de ter participado de um jogo já encerrado.
- Histórico de cartelas já utilizadas em jogos anteriores.

### Telão, locução e QR Code
- **Telão** (`display.html`, sem login): modo **Completo** (bola, últimas bolas e painel) ou **Só a bola**; faixa **"Valendo"** com o prêmio selecionado; tela de **BINGO!** com o ganhador, o critério, o prêmio e a cartela marcada quando o operador confirma o prêmio.
- **Locução**: o próprio aparelho fala a bola sorteada ("B... sete") e anuncia o ganhador, no aparelho do operador e/ou no telão (no telão é preciso tocar uma vez em "ativar a voz", regra dos navegadores). Funciona sem internet.
- **Menu "Abrir telão ▾"** (topo do Sorteio): abrir o telão, **copiar o link do telão** (para abrir em outra tela ou computador), **copiar o link para os participantes**, escolher o **QR Code que aparece no telão** (nenhum, acompanhar o sorteio, Minha cartela ou os dois), ligar a voz do telão e ver os QR Codes para imprimir.
- **Acompanhar pelo celular**: o link de participante (`display.html?u=...&m=part`) mostra a bola e o painel sem QR Code e sem voz.
- **Voz neste aparelho**: botão "Voz: ligada/desligada" no painel do Sorteio; já fala uma amostra ao ligar.
- **Minha cartela** (`cartela.html`, sem login): o participante digita o número da cartela e vê os números marcados ao vivo. Não mostra nenhum nome.

### Relatórios
- Em **Histórico**: exportar **planilha (CSV)**, que abre direto no Excel, ou **relatório para imprimir / salvar em PDF**. Os nomes dos ganhadores só entram se a opção for marcada.

### Configurações
- Intervalo numérico do sorteio (número inicial e final).
- Quantidade de últimas bolas exibidas na tela de sorteio.
- Como o telão aparece: **Completo** (bola, últimas bolas e painel com todos os números) ou **Só a bola**.
- Critérios de vitória (podem ser combinados):
  - **Cartela Cheia**
  - **Quatro Pontas** (os quatro cantos da cartela)
  - **Quina da primeira letra sorteada** (quina na coluna correspondente à letra do primeiro número sorteado da partida)
  - **Quina**, com o tipo configurável: horizontal (linha), transversal (coluna), diagonal, ou qualquer uma delas
  - **Formatos especiais**: X (as duas diagonais), Moldura, Letra T e Cruz
- Opção de a cartela ter ou não espaço livre (FREE) no centro.

## Privacidade e LGPD

O sistema foi ajustado para tratar o mínimo de dados pessoais e dar ao titular os direitos da Lei nº 13.709/2018:

| O quê | Como |
|---|---|
| **Minimização** | Só o nome/apelido do participante (para entregar o prêmio) e o login dos operadores. O cadastro avisa para não pedir CPF, telefone ou endereço. Fotos de cartela são lidas no aparelho e não são enviadas nem guardadas. |
| **Telão público** | O nome do ganhador aparece reduzido ("Maria S."), só como número da cartela ou completo — escolha do Master em Configurações › Privacidade. A redução é feita no servidor, então o nome completo nunca chega ao telão. |
| **Retenção** | Os nomes de participantes são apagados sozinhos X dias depois do fim da partida (7, 30, 90, 180, 365 ou nunca; padrão 90). Números, prêmios e estatísticas continuam. O registro de atividades é apagado depois de 90/180/365 dias. A rotina roda todo dia na API. |
| **Direitos do titular** | Em Configurações › Privacidade: **Baixar meus dados** (JSON com tudo o que existe sobre o usuário) e **Apagar nomes** das partidas encerradas (o Master pode fazer isso para todos). |
| **Transparência** | `privacidade.html` — Política de Privacidade preenchida com a organização e o encarregado (DPO) configurados pelo Master; link no login, no telão e na Minha cartela. |
| **Segurança** | Senhas com bcrypt, limite de tentativas de login, saída por inatividade, **registro de atividades** (logins, falhas, usuários, permissões, exclusões, exportações, anonimizações) com IP truncado, **Content-Security-Policy** (nada é carregado de sites externos — OCR, QR Code e fonte ficam em `vendor/` e `fonts/`), HTTPS com HSTS e **backup diário criptografado**. |

## Backup automático (criptografado)

O serviço `backup` do `docker-compose.yml` faz uma cópia do banco ao subir e depois todo dia às `BACKUP_HOUR` (padrão 3h, horário de Brasília), em `./backups/`, compactada e criptografada com AES-256. Guarda `BACKUP_KEEP_DAYS` dias (padrão 14).

1. No `.env` da VPS, defina a senha do backup (sem ela **nenhuma cópia é gravada**, porque o banco tem dados pessoais):
   ```bash
   echo "BACKUP_PASSPHRASE=$(openssl rand -base64 32)" >> .env
   ```
   Guarde essa senha **fora da VPS** (gerenciador de senhas): sem ela não dá para restaurar.
2. `docker compose up -d --build` e confira: `docker compose logs backup` deve mostrar `[backup] ok: bingo_....sql.gz.enc`.
3. Para restaurar uma cópia (substitui todo o banco atual):
   ```bash
   docker compose exec backup restore.sh bingo_2026-10-04_0300.sql.gz.enc
   ```
4. Recomendado: copiar a pasta `backups/` periodicamente para outro lugar (outro servidor, nuvem).

## HTTPS

O container já sabe ligar o HTTPS sozinho: ao subir, se existir o certificado de `BINGO_DOMAIN` em `/etc/letsencrypt` no host, ele ativa a porta 443 (publicada na VPS como `BINGO_HTTPS_PORT`, padrão `8443`, já que a 443 pode ser de outro app). A câmera do celular (escanear cartela) só funciona em HTTPS.

1. Emita o certificado na VPS (uma vez), usando a pasta de desafio que o Bingo já serve:
   ```bash
   sudo apt install certbot
   sudo certbot certonly --webroot -w ~/Bingo/certbot-webroot -d bingo.sauberlich.com.br
   ```
   (O desafio é feito pela porta 80 do domínio; se a 80 for de outro app, ele precisa repassar `/.well-known/acme-challenge/` para a porta 8082 do Bingo.)
2. `docker compose restart bingo` — o log mostra `[bingo] HTTPS ativado`.
3. Acesse `https://bingo.sauberlich.com.br:8443` (ou pela 443, se ela estiver livre: `BINGO_HTTPS_PORT=443` no `.env`).
4. Renovação: o Certbot renova sozinho; depois de cada renovação, `docker compose restart bingo` (dá para automatizar com `--deploy-hook "docker restart bingo"`).

## Design

Interface mobile-first, com navegação inferior por abas (Sorteio / Cartelas / Configurações), pensada para uso em celular durante a condução do bingo, mas totalmente utilizável em telas maiores.

## Instalar como aplicativo (PWA)

A aplicação é um **Progressive Web App**: dá pra instalar tanto no computador quanto no celular, abrindo em sua própria janela/ícone, sem barra de endereço do navegador — 100% em formato de app, mas continua sendo a mesma aplicação responsiva, sem instalador nem loja de aplicativos. Ela também continua funcionando se a internet cair no meio de uma partida (o estado do jogo já vive todo em `localStorage`; só o carregamento inicial da página depende de rede).

**Requisito:** precisa estar servida em HTTPS (ou `localhost`) — funciona automaticamente assim que o domínio (`https://bingo.sauberlich.com.br/`) estiver com certificado ativo. Por IP/HTTP puro a instalação não fica disponível, do mesmo jeito que a câmera (ver aviso na seção da VPS acima).

**No computador (Windows, Mac ou Linux)** — Chrome ou Edge:
1. Abra o site.
2. Clique no ícone de instalação (⊕/tela com seta) que aparece do lado direito da barra de endereço — ou vá no menu (⋮) → **"Instalar Bingo..."**.
3. O app abre numa janela própria, com ícone no menu iniciar/dock, como qualquer outro programa instalado.

**No Android** — Chrome:
1. Abra o site.
2. Toque no menu (⋮) → **"Instalar aplicativo"** (ou no banner que o Chrome mostra automaticamente).
3. Um ícone é adicionado à tela inicial, abrindo em tela cheia como um app nativo.

**No iPhone/iPad** — Safari (é o único navegador no iOS que consegue instalar):
1. Abra o site.
2. Toque no ícone de compartilhar (□ com uma seta para cima).
3. Toque em **"Adicionar à Tela de Início"**.
4. O ícone aparece na tela inicial e abre em tela cheia, sem a interface do Safari.

## Rodando localmente

Não há build nem dependências de back-end — basta servir os arquivos estáticos:

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

O reconhecimento de números por câmera exige HTTPS (ou `localhost`) para o navegador conceder acesso à câmera. A biblioteca de OCR fica no próprio projeto (`vendor/tesseract`), então não precisa de internet externa.

## Publicando no GitHub Pages

1. Nas configurações do repositório, vá em **Pages**.
2. Em "Source", selecione a branch `main` e a pasta `/ (root)`.
3. Salve — o site ficará disponível em `https://heberson5.github.io/Bingo/` (o nome do repositório entra na URL exatamente como está escrito — `Bingo`, não `BINGO`).

## Publicando em uma VPS com Docker

O repositório já vem com `Dockerfile` + `docker-compose.yml` prontos: a imagem só empacota um Nginx servindo os arquivos estáticos, sem nenhuma dependência de back-end.

**Pré-requisitos na VPS:** Docker e o plugin Docker Compose instalados.

```bash
# Instala o Docker (Ubuntu/Debian) — pule se já tiver
curl -fsSL https://get.docker.com | sh
```

**Subir a aplicação:**

```bash
git clone https://github.com/Heberson5/Bingo.git
cd Bingo
docker compose up -d --build
```

Isso builda a imagem e sobe o container publicando a porta `80` da VPS. Se a porta 80 já estiver em uso por outro site, edite `docker-compose.yml` e troque `"80:80"` por, por exemplo, `"8080:80"`.

Se a VPS tiver firewall (`ufw`), libere a porta usada:

```bash
sudo ufw allow 80/tcp
```

Acesse pelo IP da VPS: `http://SEU_IP_DA_VPS` (ou `http://SEU_IP_DA_VPS:8080` se trocou a porta).

**Atualizando depois de um novo `git push`:**

```bash
cd Bingo
git pull
docker compose up -d --build
```

Mudanças no banco de dados (novas colunas/tabelas) são aplicadas sozinhas: o container da API roda `prisma migrate deploy` toda vez que sobe, antes de aceitar requisições — não precisa rodar nada manualmente no Postgres.

Se alguém já estava com o site aberto ANTES do deploy, o navegador dela pode continuar usando `css/styles.css`/`js/*.js` antigos, cacheados, por até 1h (o build já cuida disso sozinho, revalidando a versão a cada deploy — mas se algo parecer "não atualizou" logo depois de um `docker compose up -d --build`, um F5 forçado — Ctrl+Shift+R, ou Ctrl+F5 — ou uma aba anônima resolve na hora).

**Comandos úteis:**

```bash
docker compose logs -f     # ver logs
docker compose restart     # reiniciar
docker compose down        # parar e remover o container
```

**⚠️ Sobre a câmera (escanear cartela):** navegadores só concedem acesso à câmera em `localhost` ou em conexões **HTTPS** — acessando só pelo IP em `http://`, o botão "Escanear cartela" não vai funcionar (o cadastro manual continua funcionando normalmente). Para habilitar o escaneamento é preciso um domínio apontado para a VPS e certificado HTTPS (por exemplo, com [Certbot](https://certbot.eff.org/) na frente do Nginx do container, ou um proxy reverso como Caddy/Traefik cuidando do TLS). Avise se quiser que eu prepare esse passo quando tiver o domínio.

## Estrutura do projeto

```
index.html            Marcação das telas (Sorteio, Cartelas, Histórico, Dashboard, Configurações) e modais
display.html          Telão público (bola, painel, prêmio valendo, BINGO!, voz) — js/display.js
cartela.html          "Minha cartela" pública para o participante — js/cartela.js
privacidade.html      Política de Privacidade (LGPD) — js/privacidade.js
vendor/               Tesseract.js (OCR) e gerador de QR Code, servidos localmente
backup/               Serviço de backup diário criptografado (backup.sh / restore.sh)
docker/               Script que liga o HTTPS quando o certificado existe
api/                  Back-end (login, estado, telão público, privacidade, registro de atividades)
manifest.webmanifest  Metadados do PWA (nome, ícones, cor, modo standalone)
sw.js                 Service worker: cache do app shell e uso offline
icons/                Ícones do app (normal, maskable e apple-touch) em vários tamanhos
css/styles.css        Estilos responsivos (mobile-first)
js/state.js           Estado do jogo, cartelas, configuração e regras de vitória
js/ocr.js             Captura de câmera e reconhecimento de números (Tesseract.js)
js/ui.js              Navegação, renderização das telas e eventos
js/extras.js          Privacidade, registro de atividades, QR Code, relatórios
js/voice.js           Locução (voz do navegador)
Dockerfile            Imagem Nginx servindo os arquivos estáticos
nginx.conf            Configuração do Nginx usada dentro do container
docker-compose.yml    Sobe o container pronto para uso em uma VPS
```
