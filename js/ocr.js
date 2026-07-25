/* ===================================================================
   BINGO — captura de câmera + reconhecimento (OCR) de números da cartela
   Usa a câmera do dispositivo para fotografar a cartela física e o
   Tesseract.js (carregado via CDN) para tentar ler os números impressos.
   O resultado do OCR é apenas um preenchimento automático "melhor
   esforço": o operador sempre confere/corrige os números antes de salvar.
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

  /**
   * Runs OCR on the captured image and returns an ordered list of
   * numeric tokens found (best-effort, reading order top-left to
   * bottom-right). Requires window.Tesseract (loaded from CDN).
   */
  async recognizeNumbers(dataUrl, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Biblioteca de OCR não carregada (sem conexão com a internet?).');
    }
    const result = await Tesseract.recognize(dataUrl, 'eng', {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    const words = (result.data.words || [])
      .map((w) => ({ text: w.text.replace(/[^0-9]/g, ''), y: w.bbox.y0, x: w.bbox.x0 }))
      .filter((w) => w.text.length > 0 && w.text.length <= 2);

    // Sort in reading order: row by row (approx. by y), then left to right.
    words.sort((a, b) => (Math.abs(a.y - b.y) < 20 ? a.x - b.x : a.y - b.y));

    return words.map((w) => parseInt(w.text, 10)).filter((n) => !Number.isNaN(n));
  },
};
