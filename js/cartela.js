/* ===================================================================
   BINGO — "Minha cartela" (cartela.html), página pública
   O participante digita o número da cartela e vê os números marcados,
   atualizando sozinho. A API devolve só números (nenhum nome).
=================================================================== */
(function () {
  var LETTERS = ['B', 'I', 'N', 'G', 'O'];
  var COLORS = ['var(--l-b)', 'var(--l-i)', 'var(--l-n)', 'var(--l-g)', 'var(--l-o)'];
  var userId = new URLSearchParams(location.search).get('u');
  var form = document.getElementById('lookupForm');
  var input = document.getElementById('cardNumber');
  var msg = document.getElementById('lookupMsg');
  var result = document.getElementById('result');
  var statusEl = document.getElementById('status');
  var gridEl = document.getElementById('grid');
  var hintEl = document.getElementById('resultHint');
  var current = '';
  var timer = null;

  try { input.value = sessionStorage.getItem('bingo_minha_cartela') || ''; } catch (e) { /* sem storage */ }

  if (!userId) {
    msg.textContent = 'Link incompleto. Abra esta página pelo QR Code mostrado no bingo.';
    form.querySelector('button').disabled = true;
  }

  function pill(text, cls) {
    var s = document.createElement('span');
    s.className = 'pill' + (cls ? ' pill--' + cls : '');
    s.textContent = text;
    return s;
  }

  function render(data) {
    if (!data.active) {
      result.hidden = true;
      msg.textContent = 'O sorteio não está acontecendo agora. Tente de novo quando o bingo começar.';
      return;
    }
    if (!data.found) {
      result.hidden = true;
      msg.textContent = 'Não encontramos a cartela ' + current + ' na partida de agora. Confira o número impresso.';
      return;
    }
    msg.textContent = '';
    result.hidden = false;
    statusEl.innerHTML = '';
    statusEl.appendChild(pill('Cartela nº ' + data.cardNumber));
    statusEl.appendChild(pill(data.marked + ' de ' + data.total + ' marcados'));
    (data.achievements || []).forEach(function (a) {
      statusEl.appendChild(pill((a.confirmed ? '🏆 ' : '⭐ ') + a.label + (a.confirmed ? ' — confirmado' : ' — avise o operador!'), a.confirmed ? 'ok' : 'warn'));
    });

    gridEl.innerHTML = '';
    LETTERS.forEach(function (l, i) {
      var h = document.createElement('div');
      h.className = 'bingo__letter';
      h.style.color = COLORS[i];
      h.textContent = l;
      gridEl.appendChild(h);
    });
    data.grid.forEach(function (row) {
      row.forEach(function (cell, c) {
        var d = document.createElement('div');
        d.className = 'bingo__cell' + (cell.marked ? ' is-marked' : '') + (cell.free ? ' is-free' : '') + (!cell.free && cell.value === data.lastNumber ? ' is-last' : '');
        if (cell.marked) d.style.background = COLORS[c];
        d.textContent = cell.free ? 'LIVRE' : cell.value;
        gridEl.appendChild(d);
      });
    });
    hintEl.textContent = data.drawnCount + ' bola(s) sorteada(s) até agora' + (data.lastNumber ? ' · última: ' + data.lastNumber : '') + '. Atualiza sozinho.';
  }

  async function load() {
    if (!current || !userId) return;
    try {
      var res = await fetch('/api/public/card/' + encodeURIComponent(userId) + '/' + encodeURIComponent(current), { cache: 'no-store' });
      if (res.status === 429) { msg.textContent = 'Muitas consultas seguidas. Aguarde um minuto.'; return; }
      render(await res.json());
    } catch (e) {
      msg.textContent = 'Sem conexão no momento. Tentando de novo…';
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    current = input.value.replace(/\D/g, '');
    if (!current) return;
    try { sessionStorage.setItem('bingo_minha_cartela', current); } catch (err) { /* sem storage */ }
    msg.textContent = 'Buscando…';
    load();
    clearInterval(timer);
    timer = setInterval(load, 4000);
  });

  if (input.value && userId) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'));
})();
