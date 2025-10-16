#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.sqlite');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

async function main() {
  const db = new sqlite3.Database(DB_PATH);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err){ if (err) reject(err); else resolve(this); });
  });
  const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => err ? reject(err) : resolve());
  });
  const close = () => new Promise((resolve) => db.close(() => resolve()));

  try {
    await exec('PRAGMA foreign_keys = ON');

    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager','rider')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(`CREATE TABLE IF NOT EXISTS manager_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      note TEXT
    )`);

    await run(`CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      address TEXT NOT NULL,
      items TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('delicate','non-delicate')),
      scheduled_at DATETIME NOT NULL,
      urgency TEXT NOT NULL CHECK (urgency IN ('low','medium','high')),
      status TEXT NOT NULL CHECK (status IN ('Pending','In Progress','Delivered','Canceled')) DEFAULT 'Pending',
      rider_id INTEGER,
      assigned_at DATETIME,
      started_at DATETIME,
      delivered_at DATETIME,
      canceled_at DATETIME,
      cancel_reason TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (rider_id) REFERENCES users(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS delay_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      rider_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
      FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await run('INSERT OR IGNORE INTO manager_whitelist (email, note) VALUES (?, ?)', ['manager@example.com', 'Default manager seed']);

    const passwordHash = await bcrypt.hash('rider123', 10);
    await run(`INSERT OR IGNORE INTO users (name, email, password_hash, role, active)
              VALUES ('Sample Rider', 'rider@example.com', ?, 'rider', 1)`, [passwordHash]);

    console.log('Database initialized at', DB_PATH);
  } finally {
    await close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
