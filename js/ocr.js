/* ===================================================================
   BINGO — captura de câmera + reconhecimento (OCR) de números da cartela
   Usa a câmera do dispositivo (ou uma foto da galeria) e o Tesseract.js
   (servido pelo próprio app, em vendor/tesseract) para ler os números impressos.

   Etapas:
     1. Localiza a grade 5x5 sozinho (detectGridQuad): as linhas da grade
        formam um único "desenho" ligado na foto; os 4 cantos dele viram
        o quadro inicial, que o operador ainda pode ajustar.
     2. Endireita a grade (correção de perspectiva) e acha a posição real
        de cada linha interna, faixa por faixa — cartela de papel quase
        nunca está perfeitamente plana.
     3. Cada casa é limpa antes do OCR: binarização, preenchimento das
        manchinhas brancas típicas da tinta em papel reciclado, remoção
        de restos das linhas da grade, recorte no algarismo e margem.
     4. O número precisa estar na faixa da letra da coluna (B 1-15, I
        16-30...). Várias leituras são feitas por casa (linha inteira,
        palavra, algarismo por algarismo) e vence a que cai na faixa.
     5. O número da cartela, impresso logo abaixo da grade à esquerda
        (ex.: "034"), também é lido.

   O resultado continua sendo "melhor esforço": o operador confere e
   corrige antes de salvar.
=================================================================== */

const Ocr = {
  stream: null,

  /**
   * Lists the camera devices available to the browser, for the
   * "Selecionar câmera" dropdown in Config — mainly useful on a
   * computer, where several webcams may be plugged in and there's no
   * meaningful "front/back" (facingMode) to fall back on like there is
   * on a phone. Device labels are only populated once permission has
   * been granted at least once; until then they come back blank and
   * the caller falls back to a generic "Câmera N" label.
   */
  async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  },

  async startCamera(videoEl, deviceId) {
    this.stopCamera();
    // Resolução maior = algarismos com mais pixels para o OCR.
    const size = { width: { ideal: 1920 }, height: { ideal: 1440 } };
    const video = deviceId
      ? { deviceId: { exact: deviceId }, ...size }
      : { facingMode: 'environment', ...size };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    videoEl.srcObject = this.stream;
    await videoEl.play();
  },

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  },

  capture(videoEl, canvasEl) {
    const w = videoEl.videoWidth || 640;
    const h = videoEl.videoHeight || 480;
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    return canvasEl.toDataURL('image/jpeg', 0.95);
  },

  _loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  },

  /**
   * Rotates the given image 90° clockwise and returns the new data URL.
   * Photos of a portrait card taken with the phone sideways come out
   * rotated — this lets the operator straighten it before recognition,
   * since sideways digits can't be read by OCR and the wrong edge would
   * otherwise get sliced into rows instead of columns.
   */
  async rotate90(dataUrl) {
    const img = await this._loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.height;
    canvas.height = img.width;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return canvas.toDataURL('image/jpeg', 0.95);
  },

  /* ------------------------------------------------------------------
     Utilitários de imagem (tons de cinza em Uint8Array, 1 byte/pixel)
  ------------------------------------------------------------------ */

  /** Draws `img` scaled so its longest side is at most `maxSide`, returns {gray, w, h, scale}. */
  _grayFromImage(img, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    return { gray, w, h, scale };
  },

  /**
   * Bradley adaptive threshold: a pixel is "ink" when it's noticeably
   * darker than the average of its neighbourhood. Works under uneven
   * lighting / shadows where one global threshold doesn't.
   */
  _adaptiveThreshold(gray, w, h, radius, t) {
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
      }
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1]
          - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        out[y * w + x] = gray[y * w + x] * count < sum * (1 - t) ? 1 : 0;
      }
    }
    return out;
  },

  _otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, threshold = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = i; }
    }
    return threshold;
  },

  /** Binary dilation (r=radius, square element). */
  _dilate(bin, w, h, r) {
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = bin[y * w + k];
        tmp[y * w + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x];
        out[y * w + x] = v;
      }
    }
    return out;
  },

  _erode(bin, w, h, r) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < inv.length; i++) inv[i] = bin[i] ? 0 : 1;
    const d = this._dilate(inv, w, h, r);
    for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
    return d;
  },

  /**
   * Labels 8-connected components of a binary mask. Returns
   * {labels, comps:[{id, area, minX, minY, maxX, maxY}]}.
   */
  _components(bin, w, h) {
    const labels = new Int32Array(w * h);
    const comps = [];
    const stack = new Int32Array(w * h);
    let next = 0;
    for (let start = 0; start < bin.length; start++) {
      if (!bin[start] || labels[start]) continue;
      next++;
      const c = { id: next, area: 0, minX: w, minY: h, maxX: 0, maxY: 0, sx: 0, sy: 0 };
      let sp = 0;
      stack[sp++] = start;
      labels[start] = next;
      while (sp) {
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        c.area++;
        c.sx += x;
        c.sy += y;
        if (x < c.minX) c.minX = x;
        if (x > c.maxX) c.maxX = x;
        if (y < c.minY) c.minY = y;
        if (y > c.maxY) c.maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (bin[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; }
          }
        }
      }
      comps.push(c);
    }
    return { labels, comps };
  },

  /* ------------------------------------------------------------------
     1. Localização automática da grade
  ------------------------------------------------------------------ */

  /**
   * Finds the card's 5x5 grid in the photo and returns its 4 corners
   * ({nw, ne, se, sw}, each {x,y} as 0-1 fractions), or null when no
   * convincing grid is found. The printed grid lines are one big
   * connected drawing — much bigger than any digit, and sparse (mostly
   * empty inside), which is what tells it apart from a dark background.
   */
  async detectGridQuad(dataUrl) {
    const img = await this._loadImage(dataUrl);
    // Algumas combinações de resolução/sensibilidade: foto nítida, foto
    // escura ou de baixo contraste, foto tremida.
    const attempts = [
      { maxSide: 900, t: 0.15, dilate: 1 },
      { maxSide: 900, t: 0.08, dilate: 1 },
      { maxSide: 600, t: 0.06, dilate: 0 },
      { maxSide: 450, t: 0.05, dilate: 0 },
    ];
    for (const a of attempts) {
      const quad = this._detectGridQuadOnce(img, a);
      if (quad) return quad;
    }
    return null;
  },

  _detectGridQuadOnce(img, { maxSide, t, dilate }) {
    const { gray, w, h } = this._grayFromImage(img, maxSide);
    const radius = Math.max(8, Math.round(Math.max(w, h) / 40));
    let ink = this._adaptiveThreshold(gray, w, h, radius, t);
    if (dilate) ink = this._dilate(ink, w, h, dilate); // costura linhas com falhas de impressão

    // As casas da grade são "ilhas" claras, quase quadradas e todas do
    // mesmo tamanho, cercadas pelas linhas. Isso é bem mais confiável do
    // que procurar o desenho das linhas, que pode grudar no fundo da foto.
    const paper = new Uint8Array(w * h);
    for (let i = 0; i < paper.length; i++) paper[i] = ink[i] ? 0 : 1;
    const { labels, comps } = this._components(paper, w, h);
    const minSide = Math.min(w, h);
    const cands = comps.filter((c) => {
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      if (c.minX === 0 || c.minY === 0 || c.maxX === w - 1 || c.maxY === h - 1) return false;
      if (bw < minSide / 16 || bh < minSide / 16 || bw > minSide / 3 || bh > minSide / 3) return false;
      if (bw / bh < 0.55 || bw / bh > 1.8) return false;
      return c.area / (bw * bh) > 0.45;
    }).sort((x, y) => x.area - y.area);

    // Maior grupo de casas com áreas parecidas.
    let bestI = 0, bestJ = -1;
    for (let i = 0, j = 0; i < cands.length; i++) {
      while (j + 1 < cands.length && cands[j + 1].area <= cands[i].area * 2.5) j++;
      if (j - i > bestJ - bestI) { bestI = i; bestJ = j; }
    }
    // Centro e tamanho pela caixa da casa (os algarismos dentro dela não
    // deslocam nem encolhem a medida, como aconteceria com a área).
    const cells = cands.slice(bestI, bestJ + 1).map((c) => ({ x: (c.minX + c.maxX) / 2, y: (c.minY + c.maxY) / 2, size: (c.maxX - c.minX + c.maxY - c.minY) / 2 }));
    if (cells.length < 12) return null;

    const quad = this._fitLattice(cells, ink, w, h);
    if (!quad) return null;
    const f = (p) => ({ x: Math.min(1, Math.max(0, p.x / w)), y: Math.min(1, Math.max(0, p.y / h)) });
    return { nw: f(quad.nw), ne: f(quad.ne), se: f(quad.se), sw: f(quad.sw) };
  },

  /**
   * Given the centres of candidate cells, numbers them on a lattice by
   * walking from neighbour to neighbour (tolerates perspective and a
   * tilted photo), keeps the best 5x5 block and fits a homography from
   * lattice coordinates to the photo — so even with a few cells missing
   * (glare, a finger over a corner) the 4 grid corners come out right.
   */
  _fitLattice(cells, ink, imgW, imgH) {
    const n = cells.length;
    const size = cells.map((c) => c.size).sort((a, b) => a - b)[n >> 1];
    // Passo da grade = distância típica até a casa vizinha mais próxima.
    const nearest = cells.map((c, i) => Math.min(...cells.map((q, j) => (i === j ? Infinity : Math.hypot(q.x - c.x, q.y - c.y)))));
    const spacing = nearest.slice().sort((a, b) => a - b)[n >> 1];
    // Vetores para os vizinhos imediatos.
    const vecs = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = cells[j].x - cells[i].x, dy = cells[j].y - cells[i].y;
        const d = Math.hypot(dx, dy);
        if (d > spacing * 0.75 && d < spacing * 1.3) vecs.push({ dx, dy });
      }
    }
    if (vecs.length < 8) return null;
    // Direção "horizontal" dominante: ângulo dobrado-mod-90 mais comum.
    const angles = vecs.map((v) => ((Math.atan2(v.dy, v.dx) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2));
    let bestA = 0, bestCount = -1;
    for (let k = 0; k < 90; k++) {
      const a = (k * Math.PI) / 180;
      const count = angles.filter((t) => Math.min(Math.abs(t - a), Math.PI / 2 - Math.abs(t - a)) < 0.12).length;
      if (count > bestCount) { bestCount = count; bestA = a; }
    }
    if (bestA > Math.PI / 4) bestA -= Math.PI / 2; // mais perto do horizontal
    const ax = Math.cos(bestA), ay = Math.sin(bestA);

    // Caminha de vizinho em vizinho atribuindo (coluna, linha).
    const seed = cells.reduce((best, c, i) => {
      const mx = cells.reduce((s, q) => s + q.x, 0) / n, my = cells.reduce((s, q) => s + q.y, 0) / n;
      const d = Math.hypot(c.x - mx, c.y - my);
      return d < best.d ? { i, d } : best;
    }, { i: 0, d: Infinity }).i;
    const pos = new Array(n).fill(null);
    pos[seed] = { i: 0, j: 0 };
    const queue = [seed];
    while (queue.length) {
      const a = queue.shift();
      for (let b = 0; b < n; b++) {
        if (pos[b]) continue;
        const dx = cells[b].x - cells[a].x, dy = cells[b].y - cells[a].y;
        const step = spacing * ((cells[a].size + cells[b].size) / 2) / size;
        const u = (dx * ax + dy * ay) / step, v = (-dx * ay + dy * ax) / step;
        const ru = Math.round(u), rv = Math.round(v);
        if (Math.abs(ru) + Math.abs(rv) !== 1 || Math.abs(u - ru) > 0.35 || Math.abs(v - rv) > 0.35) continue;
        pos[b] = { i: pos[a].i + ru, j: pos[a].j + rv };
        queue.push(b);
      }
    }
    // Janela 5x5: a que contém mais casas. Se faltam colunas/linhas
    // inteiras (casas da borda "vazando" numa foto tremida), várias
    // janelas empatam — desempata quem tem linha de grade de verdade em
    // volta (borda escura no contorno do quadro).
    const placed = cells.map((c, k) => ({ ...c, ...pos[k] })).filter((c, k) => pos[k]);
    const is = placed.map((c) => c.i), js = placed.map((c) => c.j);
    const windows = [];
    for (let i0 = Math.min(...is) - 4; i0 <= Math.max(...is); i0++) {
      for (let j0 = Math.min(...js) - 4; j0 <= Math.max(...js); j0++) {
        const inside = placed.filter((c) => c.i >= i0 && c.i < i0 + 5 && c.j >= j0 && c.j < j0 + 5);
        windows.push({ i0, j0, inside });
      }
    }
    const maxCount = Math.max(...windows.map((wd) => wd.inside.length));
    if (maxCount < 10) return null;
    const inkAt = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = xi + dx, yy = yi + dy;
          if (xx >= 0 && yy >= 0 && xx < imgW && yy < imgH && ink[yy * imgW + xx]) return 1;
        }
      }
      return 0;
    };
    let chosen = null;
    for (const wd of windows.filter((x) => x.inside.length === maxCount)) {
      const pts = wd.inside.map((c) => ({ u: (c.i - wd.i0 + 0.5) / 5, v: (c.j - wd.j0 + 0.5) / 5, x: c.x, y: c.y }));
      const H = this._fitHomography(pts);
      if (!H) continue;
      const map = (u, v) => {
        const d = H[6] * u + H[7] * v + 1;
        return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
      };
      let hitsInk = 0, total = 0;
      for (let k = 0; k <= 100; k++) {
        const t = k / 100;
        for (const [u, v] of [[t, 0], [t, 1], [0, t], [1, t]]) {
          const m = map(u, v);
          total++;
          hitsInk += inkAt(m.x, m.y);
        }
      }
      const borderScore = hitsInk / total;
      if (!chosen || borderScore > chosen.borderScore) chosen = { pts, map, borderScore };
    }
    if (!chosen) return null;
    const { pts, map } = chosen;
    const quad = { nw: map(0, 0), ne: map(1, 0), se: map(1, 1), sw: map(0, 1) };

    // Confere a geometria antes de aceitar: quadrilátero convexo, casas
    // bem encaixadas na malha e a maior parte das 25 posições ocupadas.
    const corners = [quad.nw, quad.ne, quad.se, quad.sw];
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const a = corners[k], b = corners[(k + 1) % 4], c = corners[(k + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (!Number.isFinite(cross) || cross === 0) return null;
      if (sign && Math.sign(cross) !== sign) return null;
      sign = Math.sign(cross);
    }
    const err = pts.reduce((acc, p) => { const m = map(p.u, p.v); return acc + Math.hypot(m.x - p.x, m.y - p.y); }, 0) / pts.length;
    if (err > spacing * 0.15) return null;
    let hits = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const m = map((i + 0.5) / 5, (j + 0.5) / 5);
        if (cells.some((c) => Math.hypot(c.x - m.x, c.y - m.y) < spacing * 0.3)) hits++;
      }
    }
    if (hits < 12 || chosen.borderScore < 0.5) return null;
    return quad;
  },

  /** Least-squares homography (u,v)->(x,y) from >= 4 point pairs. */
  _fitHomography(pts) {
    const A = Array.from({ length: 8 }, () => new Array(9).fill(0));
    for (const { u, v, x, y } of pts) {
      const rows = [
        [u, v, 1, 0, 0, 0, -u * x, -v * x, x],
        [0, 0, 0, u, v, 1, -u * y, -v * y, y],
      ];
      for (const r of rows) {
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 9; j++) A[i][j] += r[i] * r[j];
        }
      }
    }
    for (let col = 0; col < 8; col++) {
      let piv = col;
      for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-12) return null;
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let r = 0; r < 8; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let j = col; j < 9; j++) A[r][j] -= f * A[col][j];
      }
    }
    return A.map((r, i) => r[8] / r[i]);
  },

  /* ------------------------------------------------------------------
     2. Correção de perspectiva
  ------------------------------------------------------------------ */

  /**
   * Projective homography mapping the unit square (u,v) onto the
   * quadrilateral p0-p1-p2-p3 (TL, TR, BR, BL) — Heckbert's
   * square-to-quad method.
   */
  _squareToQuadHomography(p0, p1, p2, p3) {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;

    let g = 0, h = 0;
    if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
      const denom = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / denom;
      h = (dx1 * dy3 - dx3 * dy1) / denom;
    }
    return {
      a: p1.x - p0.x + g * p1.x,
      b: p3.x - p0.x + h * p3.x,
      c: p0.x,
      d: p1.y - p0.y + g * p1.y,
      e: p3.y - p0.y + h * p3.y,
      f: p0.y,
      g,
      h,
    };
  },

  _mapUnitSquareToQuad(hom, u, v) {
    const denom = 1 + hom.g * u + hom.h * v;
    return {
      x: (hom.a * u + hom.b * v + hom.c) / denom,
      y: (hom.d * u + hom.e * v + hom.f) / denom,
    };
  },

  /**
   * Samples the region u∈[u0,u1], v∈[v0,v1] of the quad (u/v may go
   * outside 0-1, e.g. to reach the card number printed below the grid)
   * into a `outW`x`outH` grayscale buffer, with bilinear interpolation.
   */
  _warpRegion(src, hom, u0, u1, v0, v1, outW, outH) {
    const { gray, w, h } = src;
    const out = new Uint8Array(outW * outH);
    for (let py = 0; py < outH; py++) {
      const v = v0 + (v1 - v0) * (py + 0.5) / outH;
      for (let px = 0; px < outW; px++) {
        const u = u0 + (u1 - u0) * (px + 0.5) / outW;
        const p = this._mapUnitSquareToQuad(hom, u, v);
        const x = Math.min(w - 1.001, Math.max(0, p.x - 0.5));
        const y = Math.min(h - 1.001, Math.max(0, p.y - 0.5));
        const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
        const i = yi * w + xi;
        const top = gray[i] * (1 - fx) + gray[i + 1] * fx;
        const bot = gray[i + w] * (1 - fx) + gray[i + w + 1] * fx;
        out[py * outW + px] = top * (1 - fy) + bot * fy;
      }
    }
    return out;
  },

  /**
   * Finds the real position of each grid line inside the straightened
   * grid. `profileAxis` 'x' looks for vertical lines (within the row
   * band y0-y1), 'y' for horizontal ones (within column band x0-x1).
   * Returns 6 positions (both borders + 4 inner lines).
   */
  _findLines(mask, S, axis, b0, b1) {
    const profile = new Float32Array(S);
    for (let t = 0; t < S; t++) {
      let n = 0;
      for (let k = b0; k < b1; k++) n += axis === 'x' ? mask[k * S + t] : mask[t * S + k];
      profile[t] = n / (b1 - b0);
    }
    const smooth = new Float32Array(S);
    for (let t = 0; t < S; t++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, t - 2); k <= Math.min(S - 1, t + 2); k++) { s += profile[k]; c++; }
      smooth[t] = s / c;
    }
    // Linha da grade = pico FINO (a vizinhança logo ao lado é papel); o
    // traço de um algarismo é grosso e não passa nesse teste.
    const d = Math.max(6, Math.round(S / 90));
    const ridge = (t) => smooth[t] - (smooth[Math.max(0, t - d)] + smooth[Math.min(S - 1, t + d)]) / 2;
    const lines = [];
    for (let i = 0; i <= 5; i++) {
      const expected = (i * S) / 5;
      const win = S * 0.05;
      const lo = Math.max(0, Math.round(expected - win)), hi = Math.min(S - 1, Math.round(expected + win));
      let bestT = expected, bestV = -Infinity;
      for (let t = lo; t <= hi; t++) {
        const v = ridge(t) - Math.abs(t - expected) / (S * 2);
        if (v > bestV) { bestV = v; bestT = t; }
      }
      lines.push(smooth[bestT] > 0.45 && ridge(bestT) > 0.25 ? bestT : expected);
    }
    return lines;
  },

  /* ------------------------------------------------------------------
     3. Limpeza de cada casa
  ------------------------------------------------------------------ */

  /**
   * Removes long straight strokes (grid-line remnants) that run along
   * the edges of a cell crop, allowing a small tilt. Digits never span
   * 60% of the cell height *and* sit in the outer band, so they survive.
   */
  _clearStraightLines(bin, w, h) {
    const thick = Math.max(2, Math.round(Math.min(w, h) / 45));
    const pass = (len, span, at, clear) => {
      for (let s0 = 0; s0 < span; s0++) {
        if (s0 > span * 0.2 && s0 < span * 0.8) continue;
        for (let k = -0.12; k <= 0.121; k += 0.02) {
          let n = 0;
          for (let t = 0; t < len; t++) {
            const o = Math.round(s0 + k * (t - len / 2));
            if (o < 0 || o >= span) continue;
            if (at(o, t) || (o + 1 < span && at(o + 1, t)) || (o > 0 && at(o - 1, t))) n++;
          }
          if (n < len * 0.6) continue;
          for (let t = 0; t < len; t++) {
            const o = Math.round(s0 + k * (t - len / 2));
            for (let q = o - thick; q <= o + thick; q++) if (q >= 0 && q < span) clear(q, t);
          }
        }
      }
    };
    pass(h, w, (x, y) => bin[y * w + x], (x, y) => { bin[y * w + x] = 0; });
    pass(w, h, (y, x) => bin[y * w + x], (y, x) => { bin[y * w + x] = 0; });
  },

  /**
   * Turns a grayscale crop into a clean black-on-white image of just the
   * printed number. Returns {canvas, digits:[canvas...]} or null if the
   * cell looks empty. `mode`: 'full' (fecha manchinhas + remove riscos
   * finos), 'close' (só fecha manchinhas) ou 'plain' (sem morfologia).
   */
  _cleanCell(gray, w, h, mode = 'full') {
    const thr = this._otsu(gray);
    let bin = new Uint8Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = gray[i] < thr ? 1 : 0;
    // Fecha os pontinhos brancos dentro do traço (tinta em papel reciclado).
    if (mode !== 'plain') {
      const r = Math.max(1, Math.round(Math.min(w, h) / 70));
      bin = this._erode(this._dilate(bin, w, h, r), w, h, r);
    }
    if (mode === 'full') {
      // Abertura: some com riscos finos (sombra, borda torta) mais finos
      // que o traço do algarismo.
      const ro = Math.max(1, Math.round(Math.min(w, h) / 75));
      bin = this._dilate(this._erode(bin, w, h, ro), w, h, ro);
    }

    // Apaga restos das linhas da grade nas bordas da casa — inclusive
    // levemente inclinados (papel curvado) e encostados no algarismo.
    this._clearStraightLines(bin, w, h);

    const { labels, comps } = this._components(bin, w, h);
    const area = w * h;
    const keep = new Set();
    for (const c of comps) {
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      const touches = c.minX === 0 || c.minY === 0 || c.maxX === w - 1 || c.maxY === h - 1;
      if (c.area < area * 0.004) continue; // poeira
      if (bh < h * 0.25) continue; // baixo demais para ser algarismo
      if (touches && (bw < w * 0.12 || bh < h * 0.12 || bw > w * 0.9 || bh > h * 0.95)) continue; // resto de linha
      if (bw / bh > 3 || bh / bw > 8) continue; // traço reto
      keep.add(c.id);
    }
    if (!keep.size) return null;

    const kept = comps.filter((c) => keep.has(c.id));
    const minX = Math.min(...kept.map((c) => c.minX)), maxX = Math.max(...kept.map((c) => c.maxX));
    const minY = Math.min(...kept.map((c) => c.minY)), maxY = Math.max(...kept.map((c) => c.maxY));

    const render = (x0, x1) => {
      const bw = x1 - x0 + 1, bh = maxY - minY + 1;
      const targetH = 72, margin = 22;
      const scale = targetH / bh;
      const cw = Math.round(bw * scale) + margin * 2, ch = targetH + margin * 2;
      const small = document.createElement('canvas');
      small.width = bw;
      small.height = bh;
      const sctx = small.getContext('2d');
      const id = sctx.createImageData(bw, bh);
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const p = (minY + y) * w + (x0 + x);
          const ink = keep.has(labels[p]) ? 0 : 255;
          const o = (y * bw + x) * 4;
          id.data[o] = id.data[o + 1] = id.data[o + 2] = ink;
          id.data[o + 3] = 255;
        }
      }
      sctx.putImageData(id, 0, 0);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, margin, margin, cw - margin * 2, targetH);
      return canvas;
    };

    // Separa os algarismos: pelos blocos de tinta, ou pelo "vale" central
    // quando os dois algarismos se encostam.
    const sorted = kept.slice().sort((a, b) => a.minX - b.minX);
    const groups = [];
    for (const c of sorted) {
      const last = groups[groups.length - 1];
      const overlap = last ? Math.min(last.maxX, c.maxX) - Math.max(last.minX, c.minX) : -1;
      if (last && overlap > 0.5 * Math.min(c.maxX - c.minX, last.maxX - last.minX)) {
        last.minX = Math.min(last.minX, c.minX);
        last.maxX = Math.max(last.maxX, c.maxX);
      } else groups.push({ minX: c.minX, maxX: c.maxX });
    }
    let digitRanges = groups.map((g) => [g.minX, g.maxX]);
    const fullW = maxX - minX + 1, fullH = maxY - minY + 1;
    if (digitRanges.length === 1 && fullW > fullH * 1.05) {
      let cut = -1, cutV = Infinity;
      for (let x = minX + Math.round(fullW * 0.3); x <= minX + Math.round(fullW * 0.7); x++) {
        let n = 0;
        for (let y = minY; y <= maxY; y++) if (keep.has(labels[y * w + x])) n++;
        if (n < cutV) { cutV = n; cut = x; }
      }
      if (cut > 0) digitRanges = [[minX, cut], [cut + 1, maxX]];
    }

    return {
      canvas: render(minX, maxX),
      digits: digitRanges.length >= 1 && digitRanges.length <= 3 ? digitRanges.map(([a, b]) => render(a, b)) : [],
    };
  },

  /* ------------------------------------------------------------------
     4. OCR com validação pela faixa da coluna
  ------------------------------------------------------------------ */

  async _read(worker, canvas, psm) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    return { text: (data.text || '').replace(/[^0-9]/g, ''), conf: data.confidence || 0 };
  },

  /**
   * Reads one cell. `variants` are differently-cleaned versions of the
   * same cell, tried in order only while the reading is still doubtful
   * (out of the column's range, repeated on the card, or low confidence).
   */
  async _recognizeCell(worker, variants, range, used, exhaustive = false) {
    const [lo, hi] = range;
    const inRange = (n) => n >= lo && n <= hi;
    const votes = new Map();
    const vote = (text, conf, weight) => {
      if (!text) return;
      const n = parseInt(text, 10);
      if (Number.isNaN(n)) return;
      const v = votes.get(n) || { n, score: 0, conf: 0 };
      v.score += weight * (inRange(n) ? 1 : 0.2) * (used.has(n) ? 0.35 : 1);
      v.conf = Math.max(v.conf, conf);
      votes.set(n, v);
    };
    const best = () => Array.from(votes.values()).sort((a, b) => b.score - a.score || b.conf - a.conf)[0];
    const sure = () => {
      if (exhaustive) return false;
      const b = best();
      return b && inRange(b.n) && !used.has(b.n) && b.conf >= 80;
    };

    for (const make of variants) {
      const cleaned = make();
      if (!cleaned) continue;

      const line = await this._read(worker, cleaned.canvas, '7');
      vote(line.text, line.conf, 1 + line.conf / 100);
      if (sure()) break;

      if (cleaned.digits.length) {
        let joined = '', conf = 100;
        for (const d of cleaned.digits) {
          const r = await this._read(worker, d, '10');
          joined += r.text.slice(0, 1);
          conf = Math.min(conf, r.conf);
        }
        if (joined.length === cleaned.digits.length) vote(joined, conf, 1 + conf / 100);
      }

      const word = await this._read(worker, cleaned.canvas, '8');
      vote(word.text, word.conf, 0.8 + word.conf / 100);
      if (sure()) break;
    }

    // Leituras fora da faixa da coluna: um algarismo a mais/menos ("474"
    // no lugar de "74") ou uma troca típica de algarismo parecido ("52"
    // na coluna O só pode ser "62").
    const LOOKALIKE = { 0: '869', 1: '74', 2: '7', 3: '859', 4: '1', 5: '638', 6: '580', 7: '12', 8: '3609', 9: '803' };
    for (const v of Array.from(votes.values())) {
      const s = String(v.n);
      if (inRange(v.n)) continue;
      if (s.length >= 2) {
        for (const alt of [s.slice(1), s.slice(0, -1), s.slice(0, 2), s.slice(-2)]) {
          if (alt && inRange(parseInt(alt, 10))) vote(alt, v.conf, 0.6);
        }
      }
      for (let i = 0; i < s.length; i++) {
        for (const d of LOOKALIKE[s[i]] || '') {
          const alt = s.slice(0, i) + d + s.slice(i + 1);
          if (inRange(parseInt(alt, 10))) vote(alt, v.conf, 0.5);
        }
      }
    }

    const ranked = Array.from(votes.values()).sort((a, b) => b.score - a.score || b.conf - a.conf);
    return ranked.map((v) => ({ ...v, inRange: inRange(v.n) }));
  },

  /**
   * A number never repeats on a bingo card: when two cells read the same
   * value, the more confident one keeps it and the other falls back to
   * its next candidate. Replaces each cell's candidate list by the
   * chosen number (or null) in place.
   */
  _resolveDuplicates(rows) {
    const pairs = [];
    rows.forEach((row, r) => row.forEach((cands, c) => {
      if (!Array.isArray(cands)) return;
      cands.forEach((v) => pairs.push({ r, c, v }));
    }));
    // Primeiro os palpites dentro da faixa, do mais forte ao mais fraco.
    pairs.sort((a, b) => (b.v.inRange - a.v.inRange) || (b.v.score - a.v.score) || (b.v.conf - a.v.conf));
    const taken = new Set();
    const chosen = new Map();
    for (const { r, c, v } of pairs) {
      const key = r * 5 + c;
      if (chosen.has(key) || !v.inRange || taken.has(v.n)) continue;
      chosen.set(key, v.n);
      taken.add(v.n);
    }
    rows.forEach((row, r) => row.forEach((cands, c) => {
      if (!Array.isArray(cands)) return;
      const key = r * 5 + c;
      rows[r][c] = chosen.has(key) ? chosen.get(key) : (cands[0] ? cands[0].n : null);
    }));
  },

  /** Lazily-built cleaned versions of cell (r,c) for several crop paddings. */
  _cellVariants(grid, S, colLines, rowLines, r, c, pads) {
    const variants = [];
    for (const padFrac of pads) {
      let crop = null, cw = 0, ch = 0;
      const build = () => {
        if (crop) return;
        let x0 = colLines[r][c], x1 = colLines[r][c + 1];
        let y0 = rowLines[c][r], y1 = rowLines[c][r + 1];
        const pad = (x1 - x0) * padFrac;
        x0 = Math.round(x0 + pad); x1 = Math.round(x1 - pad);
        y0 = Math.round(y0 + pad); y1 = Math.round(y1 - pad);
        cw = Math.max(8, x1 - x0); ch = Math.max(8, y1 - y0);
        crop = new Uint8Array(cw * ch);
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            crop[y * cw + x] = grid[Math.min(S - 1, Math.max(0, y0 + y)) * S + Math.min(S - 1, Math.max(0, x0 + x))];
          }
        }
      };
      for (const mode of ['full', 'close', 'plain']) variants.push(() => { build(); return this._cleanCell(crop, cw, ch, mode); });
    }
    return variants;
  },

  /**
   * Runs OCR over the 5x5 card grid outlined by `quad` (nw/ne/se/sw in
   * 0-1 fractions of the photo). `options.min/max` are the draw range
   * (to know each column's valid numbers). Returns {grid, cardNumber}:
   * grid is 5x5 numbers (null where nothing was read / free center);
   * cardNumber is the printed card number below the grid, or ''.
   * Requires window.Tesseract.
   */
  async recognizeGrid(dataUrl, freeCenter, quad, onProgress, options = {}) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Biblioteca de OCR não carregada.');
    }
    const min = options.min ?? 1;
    const max = options.max ?? 75;
    const ranges = typeof getColumnRanges === 'function'
      ? getColumnRanges(min, max)
      : [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];

    const img = await this._loadImage(dataUrl);
    const src = this._grayFromImage(img, 2200);
    const toPx = (p) => ({ x: p.x * src.w, y: p.y * src.h });
    const hom = this._squareToQuadHomography(toPx(quad.nw), toPx(quad.ne), toPx(quad.se), toPx(quad.sw));

    const S = 1000;
    const grid = this._warpRegion(src, hom, 0, 1, 0, 1, S, S);
    const lineMask = this._adaptiveThreshold(grid, S, S, 25, 0.18);

    // Tudo servido pelo próprio servidor do Bingo (pasta vendor/): o
    // reconhecimento funciona sem depender de site externo e nenhuma
    // foto ou dado sai para terceiros.
    const abs = (p) => new URL(p, window.location.href).href;
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'),
      corePath: abs('vendor/tesseract/core'),
      langPath: abs('vendor/tesseract/lang'),
      gzip: true,
    });
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });

    const result = [];
    const used = new Set();
    const totalCells = freeCenter ? 24 : 25;
    let done = 0;
    let cardNumber = '';

    try {
      // Linhas horizontais por coluna e verticais por linha (a cartela
      // de papel costuma estar levemente curvada).
      const rowLines = [];
      for (let c = 0; c < 5; c++) {
        const x0 = Math.round((c + 0.2) * S / 5), x1 = Math.round((c + 0.8) * S / 5);
        rowLines.push(this._findLines(lineMask, S, 'y', x0, x1));
      }
      const colLines = [];
      for (let r = 0; r < 5; r++) {
        const y0 = Math.round((r + 0.2) * S / 5), y1 = Math.round((r + 0.8) * S / 5);
        colLines.push(this._findLines(lineMask, S, 'x', y0, y1));
      }

      for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
          if (freeCenter && r === 2 && c === 2) {
            row.push(null);
            continue;
          }
          const ranked = await this._recognizeCell(worker, this._cellVariants(grid, S, colLines, rowLines, r, c, [0.05]), ranges[c], used);
          if (ranked.length) used.add(ranked[0].n);
          row.push(ranked);
          done++;
          if (onProgress) onProgress(Math.round((done / (totalCells + 1)) * 100));
        }
        result.push(row);
      }

      // Segunda passada só nas casas duvidosas (fora da faixa ou com o
      // mesmo número de outra casa): mais recortes e limpezas, sem parar
      // na primeira leitura.
      // Quase nada dentro da faixa = foto de lado/de ponta-cabeça: não
      // vale insistir (quem chamou gira a foto e tenta de novo).
      const plausible = result.flat().filter((cands) => Array.isArray(cands) && cands[0] && cands[0].inRange).length;
      const revisited = new Set();
      for (let round = 0; round < (plausible >= 10 ? 3 : 0); round++) {
        const tops = new Map();
        result.forEach((row) => row.forEach((cands) => {
          if (Array.isArray(cands) && cands[0]) tops.set(cands[0].n, (tops.get(cands[0].n) || 0) + 1);
        }));
        const doubtful = [];
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const cands = result[r][c];
            if (!Array.isArray(cands) || revisited.has(r * 5 + c)) continue;
            const top = cands[0];
            if (!top || !top.inRange || tops.get(top.n) > 1) doubtful.push([r, c]);
          }
        }
        if (!doubtful.length) break;
        for (const [r, c] of doubtful) {
          revisited.add(r * 5 + c);
          const again = await this._recognizeCell(worker, this._cellVariants(grid, S, colLines, rowLines, r, c, [0.03, 0.05, 0.08]), ranges[c], new Set(), true);
          const merged = new Map(result[r][c].map((v) => [v.n, { ...v }]));
          for (const v of again) {
            const m = merged.get(v.n);
            if (m) { m.score += v.score; m.conf = Math.max(m.conf, v.conf); } else merged.set(v.n, { ...v });
          }
          result[r][c] = Array.from(merged.values()).sort((a, b) => b.score - a.score || b.conf - a.conf);
        }
      }

      this._resolveDuplicates(result);

      // Número da cartela: faixa logo abaixo da grade, no canto esquerdo.
      try {
        const NW = 420, NH = 120;
        const bottom = rowLines.slice(0, 2).reduce((acc, l) => acc + l[5], 0) / 2 / S;
        const strip = this._warpRegion(src, hom, -0.01, 0.3, bottom + 0.012, bottom + 0.11, NW, NH);
        const cleaned = this._cleanCell(strip, NW, NH);
        if (cleaned) {
          const r = await this._read(worker, cleaned.canvas, '7');
          if (r.text.length >= 1 && r.text.length <= 6) cardNumber = r.text;
        }
      } catch (e) { /* número da cartela é opcional */ }
      if (onProgress) onProgress(100);
    } finally {
      await worker.terminate();
    }

    return { grid: result, cardNumber };
  },
};
