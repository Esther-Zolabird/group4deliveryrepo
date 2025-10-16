const express = require('express');
const { run, get, all } = require('../../db');

module.exports = function(io) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const q = req.query;
      const filters = buildFilters(q, req.session.user.id);
      const deliveries = await all(`SELECT d.* FROM deliveries d ${filters.where} ${filters.order}`, filters.params);
      const history = await all(`SELECT d.* FROM deliveries d WHERE d.rider_id = ? AND d.status='Delivered' ORDER BY d.delivered_at DESC LIMIT 50`, [req.session.user.id]);
      res.render('rider/dashboard', { deliveries, history, q });
    } catch (e) { next(e); }
  });

  router.post('/deliveries/:id/status', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const d = await get('SELECT * FROM deliveries WHERE id = ? AND rider_id = ?', [id, req.session.user.id]);
      if (!d) return res.status(404).send('Not found');
      const fields = [];
      if (status === 'In Progress' && d.status === 'Pending') fields.push('started_at=CURRENT_TIMESTAMP');
      if (status === 'Delivered' && (d.status === 'Pending' || d.status === 'In Progress')) fields.push('delivered_at=CURRENT_TIMESTAMP');
      await run(`UPDATE deliveries SET status=?, updated_at=CURRENT_TIMESTAMP ${fields.length ? ',' + fields.join(',') : ''} WHERE id=?`, [status, id]);
      io.to('role:manager').emit('delivery:update', { id: Number(id), status });
      res.redirect('/rider');
    } catch (e) { next(e); }
  });

  router.post('/deliveries/:id/delay', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      await run('INSERT INTO delay_reports (delivery_id, rider_id, reason) VALUES (?, ?, ?)', [id, req.session.user.id, reason || '']);
      io.to('role:manager').emit('delivery:delay', { deliveryId: Number(id), riderId: req.session.user.id, reason });
      res.redirect('/rider');
    } catch (e) { next(e); }
  });

  return { router };
};

function buildFilters(q, riderId) {
  const where = ['d.rider_id = ?'];
  const params = [riderId];
  if (q.status && q.status !== 'all') { where.push('d.status = ?'); params.push(q.status); }
  if (q.urgency && q.urgency !== 'all') { where.push('d.urgency = ?'); params.push(q.urgency); }
  if (q.category && q.category !== 'all') { where.push('d.category = ?'); params.push(q.category); }
  if (q.recipient) { where.push('LOWER(d.recipient_name) LIKE ?'); params.push('%' + q.recipient.toLowerCase() + '%'); }
  if (q.date_from) { where.push('datetime(d.scheduled_at) >= datetime(?)'); params.push(q.date_from); }
  if (q.date_to) { where.push('datetime(d.scheduled_at) <= datetime(?)'); params.push(q.date_to); }
  const order = buildOrder(q.sort);
  return { where: 'WHERE ' + where.join(' AND '), order, params };
}

function buildOrder(sortKey) {
  const map = {
    status: 'd.status ASC', urgency: 'CASE d.urgency WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END',
    recipient: 'd.recipient_name ASC', date: 'd.scheduled_at ASC', category: 'd.category ASC'
  };
  const order = map[sortKey] || 'd.scheduled_at ASC';
  return 'ORDER BY ' + order;
}
