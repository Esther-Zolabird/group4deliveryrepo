const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const exphbs = require('express-handlebars');
const methodOverride = require('method-override');
const http = require('http');
const { db, run, get, all } = require('./db');
const dayjs = require('dayjs');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

const SESSION_DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(SESSION_DB_DIR)) fs.mkdirSync(SESSION_DB_DIR, { recursive: true });

// View engine
const hbs = exphbs.create({
  layoutsDir: path.join(__dirname, 'views', 'layouts'),
  partialsDir: path.join(__dirname, 'views', 'partials'),
  defaultLayout: 'main',
  helpers: {
    formatDate: (d) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : ''),
    eq: (a, b) => String(a) === String(b),
    json: (ctx) => JSON.stringify(ctx),
    itemsList: (json) => {
      try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr.join(', ') : json; } catch (e) { return json; }
    },
    urgencyClass: (u) => {
      if (u === 'high') return 'urgency-high';
      if (u === 'medium') return 'urgency-medium';
      return 'urgency-low';
    },
    statusBadge: (s) => {
      const map = { 'Pending': 'badge-pending', 'In Progress': 'badge-inprogress', 'Delivered': 'badge-delivered', 'Canceled': 'badge-canceled' };
      return map[s] || '';
    }
  }
});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: SESSION_DB_DIR }),
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

// Socket.IO rooms by user id and role
io.on('connection', (socket) => {
  socket.on('join', ({ userId, role }) => {
    if (userId) socket.join(`user:${userId}`);
    if (role) socket.join(`role:${role}`);
  });
});

// Auth helpers
function ensureAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function ensureRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) return res.status(403).send('Forbidden');
    next();
  };
}

// Locals
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Routes
const authRoutes = require('./src/routes/auth')(io);
const managerRoutes = require('./src/routes/manager')(io);
const riderRoutes = require('./src/routes/rider')(io);

app.use('/', authRoutes.router);
app.use('/manager', ensureAuth, ensureRole('manager'), managerRoutes.router);
app.use('/rider', ensureAuth, ensureRole('rider'), riderRoutes.router);

app.get('/', (req, res) => {
  if (!req.session.user) return res.render('home');
  if (req.session.user.role === 'manager') return res.redirect('/manager');
  return res.redirect('/rider');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

const PORT = Number(process.env.PORT) || 0; // 0 -> ephemeral port for local run
server.listen(PORT, () => {
  const addr = server.address();
  const actualPort = typeof addr === 'string' ? addr : addr.port;
  console.log(`Server running on port ${actualPort}`);
});
