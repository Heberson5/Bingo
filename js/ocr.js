/* ===================================================================
   BINGO — captura de câmera + reconhecimento (OCR) de números da cartela
   Usa a câmera do dispositivo para fotografar a cartela física e o
   Tesseract.js (carregado via CDN) para tentar ler os números impressos.

   Em vez de rodar o OCR na foto inteira (o que confunde o algoritmo de
   layout do Tesseract com uma grade de números soltos), a foto é
   recortada em 25 células — uma por casa da cartela — e cada célula é
   reconhecida individualmente, já na posição certa da grade. Isso é
   bem mais confiável para esse tipo de conteúdo.

   O resultado é sempre um preenchimento automático "melhor esforço":
   o operador confere/corrige os números antes de salvar a cartela.
=================================================================== */

const Ocr = {
  stream: null,

  async startCamera(videoEl) {
    this.stopCamera();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
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
    return canvasEl.toDataURL('image/png');
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
    return canvas.toDataURL('image/png');
  },

  /**
   * Computes the projective homography that maps the unit square
   * (u,v) in [0,1]x[0,1] onto an arbitrary quadrilateral p0-p1-p2-p3
   * (corners in TL, TR, BR, BL order), using Paul Heckbert's
   * square-to-quad method. This is what lets a photo of a card taken
   * at an angle (so the grid looks like a trapezoid, not a rectangle)
   * get straightened out before slicing it into 5x5 — a plain
   * axis-aligned crop divided evenly assumes the printed cells are
   * evenly spaced in the photo, which perspective breaks, especially
   * toward the edge farthest from the camera.
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
   * Warps the region of `img` bounded by `quad` (4 corners, in 0-1
   * fractions of the image, order nw/ne/se/sw) into a clean, undistorted
   * square canvas of `size`x`size` pixels. Uses nearest-neighbor
   * sampling — plenty sharp enough once followed by the upscale +
   * contrast pass each OCR cell gets.
   */
  _warpQuadToSquare(img, quad, size) {
    const toPx = (p) => ({ x: p.x * img.width, y: p.y * img.height });
    const hom = this._squareToQuadHomography(
      toPx(quad.nw), toPx(quad.ne), toPx(quad.se), toPx(quad.sw)
    );

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width;
    srcCanvas.height = img.height;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    srcCtx.drawImage(img, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, img.width, img.height).data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = size;
    outCanvas.height = size;
    const outCtx = outCanvas.getContext('2d');
    const outImageData = outCtx.createImageData(size, size);

    for (let py = 0; py < size; py++) {
      const v = py / size;
      for (let px = 0; px < size; px++) {
        const u = px / size;
        const src = this._mapUnitSquareToQuad(hom, u, v);
        const sx = Math.min(img.width - 1, Math.max(0, Math.round(src.x)));
        const sy = Math.min(img.height - 1, Math.max(0, Math.round(src.y)));
        const srcIdx = (sy * img.width + sx) * 4;
        const outIdx = (py * size + px) * 4;
        outImageData.data[outIdx] = srcData[srcIdx];
        outImageData.data[outIdx + 1] = srcData[srcIdx + 1];
        outImageData.data[outIdx + 2] = srcData[srcIdx + 2];
        outImageData.data[outIdx + 3] = 255;
      }
    }
    outCtx.putImageData(outImageData, 0, 0);
    return outCanvas;
  },

  /**
   * Crops one grid cell out of the (already perspective-corrected,
   * square) straightened grid image, shrinking inward a bit to avoid
   * grabbing printed grid lines or a sliver of the neighboring cell.
   */
  _extractCell(straightenedCanvas, row, col, inset) {
    const cellW = straightenedCanvas.width / 5;
    const cellH = straightenedCanvas.height / 5;

    const sx = col * cellW + cellW * inset;
    const sy = row * cellH + cellH * inset;
    const sw = cellW * (1 - inset * 2);
    const sh = cellH * (1 - inset * 2);

    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.08)';
    ctx.drawImage(straightenedCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  },

  // Progressively less conservative crops + different page-segmentation
  // modes, tried in order until one yields a digit. Most cells succeed
  // on the first attempt; this only adds latency for the stragglers a
  // single fixed crop/config would otherwise miss.
  _CELL_ATTEMPTS: [
    { inset: 0.08, psm: '7' }, // single line, tight-ish crop
    { inset: 0.08, psm: '8' }, // single word
    { inset: 0.02, psm: '7' }, // barely-inset crop, in case the grid didn't line up perfectly
  ],

  async _recognizeCell(worker, straightenedCanvas, row, col) {
    for (const attempt of this._CELL_ATTEMPTS) {
      await worker.setParameters({ tessedit_pageseg_mode: attempt.psm });
      const cellDataUrl = this._extractCell(straightenedCanvas, row, col, attempt.inset);
      const { data } = await worker.recognize(cellDataUrl);
      const digits = (data.text || '').replace(/[^0-9]/g, '');
      if (digits) return parseInt(digits, 10);
    }
    return null;
  },

  /**
   * Runs OCR cell-by-cell over the 5x5 card grid. `quad` is the 4
   * corners (nw/ne/se/sw, each {x,y} in 0-1 fractions of the photo)
   * the operator positioned over the number grid; the region they
   * outline is perspective-corrected into a square before slicing,
   * so a photo taken at an angle still divides evenly into 5x5.
   * Returns a 5x5 array of recognized numbers (or null where nothing
   * was read / the cell is the free center). Requires window.Tesseract.
   */
  async recognizeGrid(dataUrl, freeCenter, quad, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Biblioteca de OCR não carregada (sem conexão com a internet?).');
    }

    const img = await this._loadImage(dataUrl);
    const straightened = this._warpQuadToSquare(img, quad, 500);
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });

    const grid = [];
    const totalCells = freeCenter ? 24 : 25;
    let done = 0;

    try {
      for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
          if (freeCenter && r === 2 && c === 2) {
            row.push(null);
            continue;
          }
          row.push(await this._recognizeCell(worker, straightened, r, c));
          done++;
          if (onProgress) onProgress(Math.round((done / totalCells) * 100));
        }
        grid.push(row);
      }
    } finally {
      await worker.terminate();
    }

    return grid;
  },
};
