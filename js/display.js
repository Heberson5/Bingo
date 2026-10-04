/* ===================================================================
   BINGO — telão (display.html)
   Página pública, sem login: lê /api/public/display/:userId a cada
   1,5s. Mostra a bola, as últimas bolas, o painel, o prêmio valendo, o
   anúncio de BINGO e, se ligado nas Configurações, fala as bolas.
=================================================================== */
var LETTERS = ['B', 'I', 'N', 'G', 'O'];
  var lastRenderedCount = -1;

  // Which user's game this screen shows — set as a query param by the
  // main app (see updateDisplayLinkHref() in js/ui.js) when it builds
  // the "Abrir tela do sorteio" link, so this page works with no login
  // of its own: it can be opened on any other device/browser.
  var params = new URLSearchParams(location.search);
  var userId = params.get('u');

  var ballEl = document.getElementById('ball');
  var emptyHintEl = document.getElementById('emptyHint');
  var inactiveHintEl = document.getElementById('inactiveHint');
  var statsEl = document.getElementById('stats');
  var prizeBannerEl = document.getElementById('prizeBanner');
  var prizeNameEl = document.getElementById('prizeName');
  var winnerEl = document.getElementById('winner');
  var soundBtnEl = document.getElementById('soundBtn');
  var lastAnnouncementId = null;
  var winnerTimer = null;
  var voiceWanted = false;
  var voiceUnlocked = false;
  var lastSpokenCount = -1;

  soundBtnEl.addEventListener('click', function () {
    voiceUnlocked = true;
    soundBtnEl.hidden = true;
    Voice.say('Voz ativada');
  });
  winnerEl.addEventListener('click', function () { winnerEl.hidden = true; });
  var stageEl = document.getElementById('stage');
  var recentEl = document.getElementById('recent');
  var boardEl = document.getElementById('board');
  var LETTER_VARS = ['--l-b', '--l-i', '--l-n', '--l-g', '--l-o'];
  var lastBoardKey = '';

  function letterIndex(num, min, max) {
    var ranges = getColumnRanges(min, max);
    for (var i = 0; i < ranges.length; i++) {
      if (num >= ranges[i][0] && num <= ranges[i][1]) return i;
    }
    return 0;
  }

  function renderBoard(revealed, min, max) {
    var key = min + ':' + max + ':' + revealed.join(',');
    if (key === lastBoardKey) return;
    lastBoardKey = key;
    var drawnSet = {};
    revealed.forEach(function (n) { drawnSet[n] = true; });
    var last = revealed[revealed.length - 1];
    var ranges = getColumnRanges(min, max);
    var html = '';
    for (var c = 0; c < 5; c++) {
      var s = ranges[c][0], e = ranges[c][1];
      html += '<div class="board__row" style="--lc:var(' + LETTER_VARS[c] + ');--cols:' + (e - s + 1) + '"><span class="board__letter">' + LETTERS[c] + '</span>';
      for (var n = s; n <= e; n++) {
        html += '<span class="board__num' + (drawnSet[n] ? ' is-drawn' : '') + (n === last ? ' is-last' : '') + '">' + n + '</span>';
      }
      html += '</div>';
    }
    boardEl.innerHTML = html;

    recentEl.innerHTML = revealed.slice(-9, -1).reverse().map(function (n) {
      return '<span class="recent__ball" style="--ball:var(' + LETTER_VARS[letterIndex(n, min, max)] + ')">' + n + '</span>';
    }).join('');
  }

  function tickClock() {
    var d = new Date();
    document.getElementById('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  tickClock();
  setInterval(tickClock, 10000);

  function getColumnRanges(min, max) {
    var total = max - min + 1;
    var size = Math.floor(total / 5);
    var ranges = [];
    var start = min;
    for (var i = 0; i < 5; i++) {
      var end = i === 4 ? max : start + size - 1;
      ranges.push([start, end]);
      start = end + 1;
    }
    return ranges;
  }

  function letterForNumber(num, min, max) {
    var ranges = getColumnRanges(min, max);
    for (var i = 0; i < ranges.length; i++) {
      if (num >= ranges[i][0] && num <= ranges[i][1]) return LETTERS[i];
    }
    return '';
  }

  function showState(which) {
    stageEl.classList.toggle('is-idle', which !== 'ball');
    ballEl.hidden = which !== 'ball';
    emptyHintEl.hidden = which !== 'empty';
    inactiveHintEl.hidden = which !== 'inactive';
  }

  function applyExtras(data, revealed, min, max) {
    // Prêmio valendo
    var prize = data.prize || '';
    prizeBannerEl.hidden = !prize || !data.active;
    prizeNameEl.textContent = prize;

    // Voz: precisa de um toque na tela uma vez (regra dos navegadores).
    voiceWanted = !!data.voice;
    soundBtnEl.hidden = !(voiceWanted && !voiceUnlocked && Voice.supported());
    if (voiceWanted && voiceUnlocked && revealed && lastSpokenCount >= 0 && revealed.length > lastSpokenCount) {
      var n = revealed[revealed.length - 1];
      Voice.number(n, letterForNumber(n, min, max));
    }
    if (revealed) lastSpokenCount = revealed.length;

    // Anúncio de ganhador
    var a = data.announcement;
    if (a && a.id !== lastAnnouncementId) {
      var fresh = !a.at || (Date.now() - new Date(a.at).getTime()) < 90 * 1000;
      if (lastAnnouncementId !== null || fresh) showWinner(a);
      lastAnnouncementId = a.id;
    } else if (!a && lastAnnouncementId === null) {
      lastAnnouncementId = '';
    }
  }

  function showWinner(a) {
    document.getElementById('winnerName').textContent = a.name || '';
    var meta = [];
    if (a.criterion) meta.push(a.criterion);
    var metaEl = document.getElementById('winnerMeta');
    metaEl.textContent = meta.join(' · ');
    if (a.prize) {
      var strong = document.createElement('strong');
      strong.textContent = (meta.length ? ' · ' : '') + a.prize;
      metaEl.appendChild(strong);
    }
    var gridEl = document.getElementById('winnerGrid');
    gridEl.innerHTML = '';
    (a.grid || []).forEach(function (row) {
      row.forEach(function (cell) {
        var span = document.createElement('span');
        if (cell.f) { span.className = 'on free'; span.textContent = 'LIVRE'; }
        else { span.className = cell.m ? 'on' : ''; span.textContent = cell.v == null ? '' : cell.v; }
        gridEl.appendChild(span);
      });
    });
    gridEl.hidden = !(a.grid && a.grid.length);
    winnerEl.hidden = false;
    if (voiceWanted && voiceUnlocked) Voice.winner(a.name, a.criterion, a.prize);
    clearTimeout(winnerTimer);
    winnerTimer = setTimeout(function () { winnerEl.hidden = true; }, 15000);
  }

  function applyState(data) {
    if (!data.active) {
      applyExtras(data, null, 1, 75);
      showState('inactive');
      statsEl.textContent = '';
      lastRenderedCount = -1;
      return;
    }

    var min = data.min != null ? data.min : 1;
    var max = data.max != null ? data.max : 75;
    var drawn = data.drawnNumbers || [];

    // In suspense mode the main app deliberately holds `revealedCount`
    // behind drawnNumbers.length until the operator taps the ball there
    // — this display only ever shows numbers up to that point, so the
    // audience sees a ball appear exactly when the operator reveals it,
    // never the instant it's actually drawn.
    var revealedCount = data.suspenseMode
      ? Math.min(data.revealedCount || 0, drawn.length)
      : drawn.length;
    var revealed = drawn.slice(0, revealedCount);

    applyExtras(data, revealed, min, max);

    if (revealed.length === 0) {
      showState('empty');
      statsEl.textContent = '';
      lastRenderedCount = 0;
      return;
    }

    showState('ball');
    stageEl.classList.toggle('is-ball-only', data.telaoMode === 'bola');
    var last = revealed[revealed.length - 1];
    var idx = letterIndex(last, min, max);
    document.getElementById('letter').textContent = letterForNumber(last, min, max);
    document.getElementById('number').textContent = last;
    ballEl.style.setProperty('--ball', 'var(' + LETTER_VARS[idx] + ')');
    stageEl.style.setProperty('--ball', 'var(' + LETTER_VARS[idx] + ')');
    var total = max - min + 1;
    statsEl.innerHTML = '<strong>' + revealed.length + '</strong> de ' + total + ' bolas sorteadas';
    renderBoard(revealed, min, max);

    if (revealed.length !== lastRenderedCount) {
      ballEl.classList.remove('is-bouncing');
      void ballEl.offsetWidth;
      ballEl.classList.add('is-bouncing');
    }
    lastRenderedCount = revealed.length;
  }

  function showInvalidLink() {
    inactiveHintEl.innerHTML = '<strong>Link inválido</strong>Abra esta tela pelo botão dentro do aplicativo (ícone de monitor, no topo da tela de Sorteio).';
    showState('inactive');
  }

  async function poll() {
    try {
      var res = await fetch('/api/public/display/' + encodeURIComponent(userId), { cache: 'no-store' });
      if (!res.ok) throw new Error('http_' + res.status);
      var data = await res.json();
      applyState(data);
    } catch (e) {
      // Rede fora do ar / API indisponível — mantém o que já estava na
      // tela em vez de piscar "sessão encerrada" a cada falha passageira.
    }
  }

  if (!userId) {
    showInvalidLink();
  } else {
    poll();
    setInterval(poll, 1500);
  }
