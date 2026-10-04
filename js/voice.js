/* ===================================================================
   BINGO — locução (voz do próprio aparelho, sem internet)
   Usado pelo app do operador e pelo telão (display.html). Usa a Web
   Speech API do navegador com uma voz em português, quando houver.
=================================================================== */
const Voice = {
  _voice: null,

  supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  },

  _pickVoice() {
    if (!this.supported()) return null;
    const voices = window.speechSynthesis.getVoices();
    this._voice = voices.find((v) => /^pt[-_]BR/i.test(v.lang))
      || voices.find((v) => /^pt/i.test(v.lang))
      || null;
    return this._voice;
  },

  say(text, { rate = 0.95, pitch = 1 } = {}) {
    if (!this.supported() || !text) return;
    if (!this._voice) this._pickVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    if (this._voice) u.voice = this._voice;
    u.rate = rate;
    u.pitch = pitch;
    window.speechSynthesis.speak(u);
  },

  /** "B... sete" — a letra, uma pausa curta e o número. */
  number(num, letter) {
    if (num === null || num === undefined) return;
    this.say(letter ? `${letter}... ${num}` : String(num), { rate: 0.85 });
  },

  winner(name, criterion, prize) {
    const parts = ['Bingo!'];
    if (name) parts.push(name + '.');
    if (criterion) parts.push(criterion + '.');
    if (prize) parts.push('Prêmio: ' + prize + '.');
    this.say(parts.join(' '), { rate: 0.95 });
  },

  stop() {
    if (this.supported()) window.speechSynthesis.cancel();
  },
};

if (Voice.supported()) {
  Voice._pickVoice();
  window.speechSynthesis.onvoiceschanged = () => Voice._pickVoice();
}
