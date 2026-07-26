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
   * Crops one grid cell out of the full card photo, upscales it (OCR
   * reads small printed digits far more reliably when enlarged) and
   * applies grayscale + contrast boost to help separate ink from paper.
   */
  _extractCell(img, row, col, freeCenter) {
    const cellW = img.width / 5;
    const cellH = img.height / 5;
    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = cellW * scale;
    canvas.height = cellH * scale;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.05)';
    ctx.drawImage(
      img,
      col * cellW, row * cellH, cellW, cellH,
      0, 0, canvas.width, canvas.height
    );
    return canvas.toDataURL('image/png');
  },

  /**
   * Runs OCR cell-by-cell over the 5x5 card grid and returns a 5x5
   * array of recognized numbers (or null where nothing was read /
   * the cell is the free center). Requires window.Tesseract (CDN).
   */
  async recognizeGrid(dataUrl, freeCenter, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Biblioteca de OCR não carregada (sem conexão com a internet?).');
    }

    const img = await this._loadImage(dataUrl);
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '7', // treat each cell as a single line of text
    });

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
          const cellDataUrl = this._extractCell(img, r, c, freeCenter);
          const { data } = await worker.recognize(cellDataUrl);
          const digits = (data.text || '').replace(/[^0-9]/g, '');
          row.push(digits ? parseInt(digits, 10) : null);
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
