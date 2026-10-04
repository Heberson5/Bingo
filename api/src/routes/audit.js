const express = require('express');
const prisma = require('../prisma');
const { requireAuth, requireMaster } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireMaster);

router.get('/', async (req, res) => {
  const take = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const entries = await prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take });
  res.json({ entries });
});

module.exports = router;
