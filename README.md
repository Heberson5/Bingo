# 🎱 BINGO

Aplicação web responsiva para sortear números de bingo, cadastrar cartelas dos participantes (por escaneamento com a câmera ou manualmente), marcar automaticamente os números sorteados em cada cartela e alertar o vencedor de acordo com os critérios configurados.

Não há tela de login — a aplicação roda inteiramente no navegador (HTML/CSS/JavaScript puro, sem back-end), guardando o estado do jogo e das cartelas em `localStorage`.

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
- **Escanear cartela**: abre a câmera do dispositivo, tira uma foto da cartela física e tenta reconhecer os números automaticamente (OCR via [Tesseract.js](https://github.com/naptha/tesseract.js), carregado por CDN). Os números reconhecidos preenchem uma grade 5×5 editável para conferência/correção antes de salvar — o reconhecimento é "melhor esforço" e sempre pode ser ajustado manualmente.
- **Cadastro manual**: preenche a cartela sem usar a câmera.
- Cada cartela é vinculada a um nome de participante.
- Uma cartela com o mesmo conjunto de números não pode ser cadastrada duas vezes na mesma partida, nem reaproveitada depois de ter participado de um jogo já encerrado.
- Histórico de cartelas já utilizadas em jogos anteriores.

### Configurações
- Intervalo numérico do sorteio (número inicial e final).
- Quantidade de últimas bolas exibidas na tela de sorteio.
- Critérios de vitória (podem ser combinados):
  - **Cartela Cheia**
  - **Quatro Pontas** (os quatro cantos da cartela)
  - **Quina da primeira letra sorteada** (quina na coluna correspondente à letra do primeiro número sorteado da partida)
  - **Quina**, com o tipo configurável: horizontal (linha), transversal (coluna), diagonal, ou qualquer uma delas
- Opção de a cartela ter ou não espaço livre (FREE) no centro.

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

O reconhecimento de números por câmera exige HTTPS (ou `localhost`) para o navegador conceder acesso à câmera, e conexão com a internet para carregar a biblioteca de OCR via CDN. Sem OCR disponível, o cadastro manual continua funcionando normalmente.

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
display.html          Tela cheia do sorteio, para projetar a bola sorteada em outra tela
manifest.webmanifest  Metadados do PWA (nome, ícones, cor, modo standalone)
sw.js                 Service worker: cache do app shell e uso offline
icons/                Ícones do app (normal, maskable e apple-touch) em vários tamanhos
css/styles.css        Estilos responsivos (mobile-first)
js/state.js           Estado do jogo, cartelas, configuração e regras de vitória
js/ocr.js             Captura de câmera e reconhecimento de números (Tesseract.js)
js/ui.js              Navegação, renderização das telas e eventos
Dockerfile            Imagem Nginx servindo os arquivos estáticos
nginx.conf            Configuração do Nginx usada dentro do container
docker-compose.yml    Sobe o container pronto para uso em uma VPS
```
