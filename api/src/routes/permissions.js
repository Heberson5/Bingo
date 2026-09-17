const express = require('express');
const prisma = require('../prisma');
const { requireAuth, requireMaster } = require('../auth');

const router = express.Router();

const SETTING_KEY = 'permissions';

// Mesmos menus/seções que existem em index.html hoje. O Master nunca é
// restringido por isto (ver checagem de role no frontend) — esta lista
// só vale pra quem tem role "user". "Configurações" fica de fora da
// lista de menus de propósito: mesmo restrito, o usuário precisa
// sempre conseguir chegar no próprio "Conta" pra deslogar.
const DEFAULT_PERMISSIONS = {
  menus: { sorteio: true, cartelas: true, historico: true, dashboard: true },
  settings: {
    tema: true,
    intervaloSorteio: true,
    exibicao: true,
    criteriosVitoria: true,
    cartela: true,
    cameraComputador: false,
    aparenciaPainelNumeros: true,
    aparenciaBolaSorteada: false,
    aplicativo: false,
    identidadeVisual: false,
  },
};

// Nunca grava uma chave que a gente não conhece — value vem do body de
// um PUT, então é entrada de usuário (mesmo que só o Master chegue
// aqui).
function sanitizePermissions(value) {
  const out = { menus: {}, settings: {} };
  for (const key of Object.keys(DEFAULT_PERMISSIONS.menus)) {
    out.menus[key] = typeof value?.menus?.[key] === 'boolean' ? value.menus[key] : DEFAULT_PERMISSIONS.menus[key];
  }
  for (const key of Object.keys(DEFAULT_PERMISSIONS.settings)) {
    out.settings[key] = typeof value?.settings?.[key] === 'boolean' ? value.settings[key] : DEFAULT_PERMISSIONS.settings[key];
  }
  return out;
}

router.get('/', requireAuth, async (req, res) => {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  res.json({ value: sanitizePermissions(row ? row.value : null) });
});

router.put('/', requireAuth, requireMaster, async (req, res) => {
  const value = sanitizePermissions((req.body || {}).value);
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  res.json({ value });
});

module.exports = router;
