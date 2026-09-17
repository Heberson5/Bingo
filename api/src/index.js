const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const usersRoutes = require('./routes/users');
const permissionsRoutes = require('./routes/permissions');

const app = express();

// Atras do nginx do proprio container (mesma origem), CORS nao seria
// estritamente necessario — mantido mesmo assim para permitir rodar a
// API sozinha em desenvolvimento (frontend servido de outra porta).
app.use(cors());
app.use(express.json({ limit: '2mb' })); // cartelas + historico cabem folgado nisso

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
