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
3. Salve — o site ficará disponível em `https://<usuario>.github.io/BINGO/`.

## Estrutura do projeto

```
index.html        Marcação das três telas (Sorteio, Cartelas, Configurações) e modais
css/styles.css     Estilos responsivos (mobile-first)
js/state.js        Estado do jogo, cartelas, configuração e regras de vitória
js/ocr.js          Captura de câmera e reconhecimento de números (Tesseract.js)
js/ui.js           Navegação, renderização das telas e eventos
```
