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
   * Crops one grid cell out of the region the operator marked as the
   * number grid (cropRect, in 0-1 fractions of the full photo — real
   * photos rarely have the card filling the whole frame, and the card
   * itself usually has a header row above the grid, so cropping from
   * the raw photo edges would slice the wrong content into each cell).
   * `inset` shrinks the crop inward from each cell's edges (as a
   * fraction of the cell) to avoid grabbing printed grid lines or a
   * sliver of the neighboring cell — how much is needed varies with how
   * precisely the operator's rectangle lines up with the real grid, so
   * recognizeCell tries a couple of values instead of a single fixed one.
   */
  _extractCell(img, row, col, cropRect, inset) {
    const originX = cropRect.x * img.width;
    const originY = cropRect.y * img.height;
    const regionW = cropRect.w * img.width;
    const regionH = cropRect.h * img.height;
    const cellW = regionW / 5;
    const cellH = regionH / 5;

    const sx = originX + col * cellW + cellW * inset;
    const sy = originY + row * cellH + cellH * inset;
    const sw = cellW * (1 - inset * 2);
    const sh = cellH * (1 - inset * 2);

    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.08)';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
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

  async _recognizeCell(worker, img, row, col, cropRect) {
    for (const attempt of this._CELL_ATTEMPTS) {
      await worker.setParameters({ tessedit_pageseg_mode: attempt.psm });
      const cellDataUrl = this._extractCell(img, row, col, cropRect, attempt.inset);
      const { data } = await worker.recognize(cellDataUrl);
      const digits = (data.text || '').replace(/[^0-9]/g, '');
      if (digits) return parseInt(digits, 10);
    }
    return null;
  },

  /**
   * Runs OCR cell-by-cell over the 5x5 card grid (within cropRect, a
   * {x,y,w,h} rectangle in 0-1 fractions of the photo that the operator
   * positioned over just the number grid) and returns a 5x5 array of
   * recognized numbers (or null where nothing was read / the cell is
   * the free center). Requires window.Tesseract (CDN).
   */
  async recognizeGrid(dataUrl, freeCenter, cropRect, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Biblioteca de OCR não carregada (sem conexão com a internet?).');
    }

    const img = await this._loadImage(dataUrl);
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
          row.push(await this._recognizeCell(worker, img, r, c, cropRect));
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
