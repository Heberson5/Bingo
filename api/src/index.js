const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const usersRoutes = require('./routes/users');
const permissionsRoutes = require('./routes/permissions');

const app = express();

// A API só é alcançada através do nginx do próprio container (ver
// nginx-common.conf, proxy_set_header X-Forwarded-For) — sem isto,
// express-rate-limit enxergaria todo mundo vindo do IP interno do
// nginx e contaria as tentativas de todo mundo junto.
app.set('trust proxy', 1);

// helmet cobre os cabecalhos de seguranca padrao (no-sniff, sem
// referrer vazando pra fora, etc). CSP fica desligado por enquanto: o
// frontend carrega tesseract.js de um CDN e essa politica precisa de
// uma auditoria propria (toda tag <script>/style inline) antes de
// entrar, senao quebra a tela sem avisar.
app.use(helmet({ contentSecurityPolicy: false }));
app.disable('x-powered-by'); // helmet ja remove, redundante de proposito

// Atras do nginx do proprio container (mesma origem), CORS nao e
// necessario em producao — so liga se CORS_ORIGIN estiver definido
// (util pra rodar a API sozinha em desenvolvimento, com o frontend
// servido de outra porta). Sem essa variavel, nenhuma origem cruzada
// consegue chamar a API.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (corsOrigins.length > 0) app.use(cors({ origin: corsOrigins }));

app.use(express.json({ limit: '2mb' })); // cartelas + historico cabem folgado nisso

// Login e refresh sao os alvos classicos de forca bruta — 30
// tentativas a cada 15 min por IP ja e bem mais que qualquer uso
// legitimo (login errado por engano, refresh automatico do app).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);

// Limite geral, mais frouxo, cobrindo o resto da API como segunda
// camada contra abuso/DoS simples.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/', apiLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/state', stateRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/permissions', permissionsRoutes);

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[bingo-api] ouvindo na porta ${PORT}`));
