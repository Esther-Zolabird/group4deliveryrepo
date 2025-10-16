const express = require('express');
const dayjs = require('dayjs');
const { run, get, all } = require('../../db');

module.exports = function(io) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const riders = await all(`SELECT u.id, u.name, u.email,
        COALESCE(SUM(CASE WHEN d.status IN ('Pending','In Progress') THEN 1 ELSE 0 END), 0) AS open_count
        FROM users u
        LEFT JOIN deliveries d ON d.rider_id = u.id
        WHERE u.role = 'rider' AND u.active = 1
        GROUP BY u.id
        ORDER BY u.name`);
      const filters = buildFilters(req.query);
      const deliveries = await all(`SELECT d.*, u.name AS rider_name FROM deliveries d
        LEFT JOIN users u ON d.rider_id = u.id
        ${filters.where} ${filters.order} ${filters.limit}`, filters.params);
      const stats = await get(`SELECT 
        SUM(CASE WHEN status='Delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='In Progress' THEN 1 ELSE 0 END) AS inprogress
      FROM deliveries`, []);
      const riderPerf = await all(`SELECT u.id, u.name,
        COUNT(CASE WHEN d.status='Delivered' THEN 1 END) AS completed,
        AVG(CASE WHEN d.delivered_at IS NOT NULL AND d.started_at IS NOT NULL THEN
          (julianday(d.delivered_at) - julianday(d.started_at)) * 24 * 60 END) AS avg_minutes
      FROM users u LEFT JOIN deliveries d ON d.rider_id = u.id
      WHERE u.role='rider' AND u.active = 1
      GROUP BY u.id ORDER BY (completed IS NULL), completed DESC`);
      res.render('manager/dashboard', { riders, deliveries, stats, riderPerf, q: req.query, error: req.query.error });
    } catch (e) { next(e); }
  });

  router.post('/deliveries', async (req, res, next) => {
    try {
      const { recipient_name, recipient_phone, address, items, category, scheduled_at, urgency } = req.body;
      const itemsJson = JSON.stringify(splitItems(items));
      await run(`INSERT INTO deliveries (recipient_name, recipient_phone, address, items, category, scheduled_at, urgency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`, [recipient_name, recipient_phone, address, itemsJson, category, scheduled_at, urgency]);
      res.redirect('/manager');
    } catch (e) { next(e); }
  });

  router.post('/deliveries/:id/cancel', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      await run(`UPDATE deliveries SET status='Canceled', canceled_at=CURRENT_TIMESTAMP, cancel_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [reason || null, id]);
      io.to('role:manager').emit('delivery:update', { id: Number(id), status: 'Canceled' });
      res.redirect('/manager');
    } catch (e) { next(e); }
  });

  router.post('/deliveries/:id/status', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const fields = [];
      if (status === 'In Progress') fields.push("started_at=CURRENT_TIMESTAMP");
      if (status === 'Delivered') fields.push("delivered_at=CURRENT_TIMESTAMP");
      await run(`UPDATE deliveries SET status=?, updated_at=CURRENT_TIMESTAMP ${fields.length ? ',' + fields.join(',') : ''} WHERE id=?`, [status, id]);
      io.emit('delivery:update', { id: Number(id), status });
      res.redirect('/manager');
    } catch (e) { next(e); }
  });

  router.post('/deliveries/assign', async (req, res, next) => {
    try {
      const { rider_id } = req.body;
      let deliveryIds = [];
      if (Array.isArray(req.body.delivery_ids)) {
        deliveryIds = req.body.delivery_ids;
      } else if (typeof req.body.delivery_ids === 'string') {
        deliveryIds = req.body.delivery_ids.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      }
      if (!rider_id || deliveryIds.length === 0) return res.redirect('/manager');
      // Enforce availability: rider must not have open deliveries
      const open = await get(`SELECT COUNT(1) AS c FROM deliveries WHERE rider_id = ? AND status IN ('Pending','In Progress')`, [rider_id]);
      if (open && open.c > 0) {
        return res.redirect('/manager?error=Rider%20is%20currently%20unavailable');
      }
      // Assign multiple deliveries
      for (const dId of deliveryIds) {
        await run(`UPDATE deliveries SET rider_id=?, assigned_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('Pending','In Progress')`, [rider_id, dId]);
      }
      io.emit('assign:update', { riderId: Number(rider_id), deliveryIds: deliveryIds.map(Number) });
      res.redirect('/manager');
    } catch (e) { next(e); }
  });

  // Edit delivery
  router.get('/deliveries/:id/edit', async (req, res, next) => {
    try {
      const d = await get('SELECT * FROM deliveries WHERE id = ?', [req.params.id]);
      if (!d) return res.status(404).send('Not found');
      res.render('manager/edit', { d });
    } catch (e) { next(e); }
  });

  router.put('/deliveries/:id', async (req, res, next) => {
    try {
      const { recipient_name, recipient_phone, address, items, category, scheduled_at, urgency } = req.body;
      const itemsJson = JSON.stringify(splitItems(items));
      await run(`UPDATE deliveries SET recipient_name=?, recipient_phone=?, address=?, items=?, category=?, scheduled_at=?, urgency=?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`,
        [recipient_name, recipient_phone, address, itemsJson, category, scheduled_at, urgency, req.params.id]);
      res.redirect('/manager');
    } catch (e) { next(e); }
  });

  // View delay reports for a delivery
  router.get('/deliveries/:id/delays', async (req, res, next) => {
    try {
      const d = await get('SELECT * FROM deliveries WHERE id = ?', [req.params.id]);
      if (!d) return res.status(404).send('Not found');
      const delays = await all(`SELECT dr.*, u.name AS rider_name FROM delay_reports dr
        JOIN users u ON u.id = dr.rider_id WHERE dr.delivery_id = ? ORDER BY dr.created_at DESC`, [req.params.id]);
      res.render('manager/delays', { d, delays });
    } catch (e) { next(e); }
  });

  router.post('/riders/:id/deactivate', async (req, res, next) => {
    try {
      await run('UPDATE users SET active = 0 WHERE id = ? AND role = "rider"', [req.params.id]);
      res.redirect('/manager');
    } catch (e) { next(e); }
  });

  router.get('/export/csv', async (req, res, next) => {
    try {
      const rows = await all(`SELECT d.id, d.recipient_name, d.recipient_phone, d.address, d.items, d.category, d.scheduled_at, d.urgency, d.status, u.name AS rider_name
        FROM deliveries d LEFT JOIN users u ON d.rider_id = u.id`);
      const header = ['id','recipient_name','recipient_phone','address','items','category','scheduled_at','urgency','status','rider_name'];
      const csv = [header.join(',')].concat(rows.map(r => header.map(k => escapeCsv(k === 'items' ? r[k] : String(r[k] ?? ''))).join(','))).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="deliveries.csv"');
      res.send(csv);
    } catch (e) { next(e); }
  });

  return { router };
};

function splitItems(input) {
  if (!input) return [];
  return input.split(/\n|,/).map(s => s.trim()).filter(Boolean);
}

function escapeCsv(val) {
  const v = String(val);
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function buildFilters(q) {
  const where = [];
  const params = [];
  if (q.status && q.status !== 'all') { where.push('d.status = ?'); params.push(q.status); }
  if (q.urgency && q.urgency !== 'all') { where.push('d.urgency = ?'); params.push(q.urgency); }
  if (q.category && q.category !== 'all') { where.push('d.category = ?'); params.push(q.category); }
  if (q.rider_id && q.rider_id !== 'all') { where.push('d.rider_id = ?'); params.push(q.rider_id); }
  if (q.recipient) { where.push('LOWER(d.recipient_name) LIKE ?'); params.push('%' + q.recipient.toLowerCase() + '%'); }
  if (q.date_from) { where.push('datetime(d.scheduled_at) >= datetime(?)'); params.push(q.date_from); }
  if (q.date_to) { where.push('datetime(d.scheduled_at) <= datetime(?)'); params.push(q.date_to); }
  const order = buildOrder(q.sort);
  const limit = 'LIMIT 500';
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', order, limit, params };
}

function buildOrder(sortKey) {
  const map = {
    status: 'd.status ASC', urgency: 'CASE d.urgency WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END',
    rider: 'u.name ASC', recipient: 'd.recipient_name ASC', date: 'd.scheduled_at ASC', category: 'd.category ASC'
  };
  const order = map[sortKey] || 'd.scheduled_at DESC';
  return 'ORDER BY ' + order;
}
