'use strict';
// zcode-runtime.js — detect whether ZCode is running and keep the DB readable
// after ZCode exits.
//
// Why this exists (the real root cause of "can't see history after ZCode closes"):
//   ZCode uses SQLite in WAL mode. While ZCode is running, every connection
//   (even read-only) reads the freshest data because the live process maintains
//   the WAL shared-memory index (-shm). When ZCode exits abnormally, the WAL
//   may contain un-checkpointed data that a fresh read-only connection CANNOT
//   recover — we observed it reading weeks-old data in that case.
//
// Fix:
//   1. Probe whether ZCode is running (process + lock check, cross-platform).
//   2. While ZCode runs → read-only direct connection (current behavior).
//   3. When we detect ZCode has just exited → open ONE writable connection and
//      run wal_checkpoint(TRUNCATE) to fold the WAL into the main db. After
//      that, all read-only connections see complete history. We never write
//      to the db ourselves — checkpoint only reorganizes existing WAL frames.
//
// The writable connection is only opened transiently for the checkpoint, and
// only when ZCode is NOT running (so we never contend with its writer).

const { execFileSync } = require('child_process');
const fs = require('fs');
const Database = require('better-sqlite3');

// Detect ZCode running via process list. Returns boolean.
// Matches the Electron app binary path (cross-platform-ish) and the CLI helper.
function isZCodeRunning() {
  try {
    // `ps -axo comm` gives the executable path; matching is robust to args.
    const out = execFileSync('ps', ['-axo', 'comm'], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const lines = out.split('\n');
    return lines.some(line => {
      const l = line.trim();
      // Match the ZCode app on macOS, the .exe on Windows, and the linux binary.
      return /\/ZCode\.app\//.test(l)
          || /(^|\/)zcode-cli$/.test(l)
          || /(^|\/)zcode-host-local/.test(l)
          || /(^|\/)ZCode(\.exe)?$/.test(l);
    });
  } catch {
    // ps failed (non-unix?) — fall back to optimistic: assume running so we
    // stay in safe read-only mode rather than risk a contended checkpoint.
    return true;
  }
}

// Returns { walBytes, shmBytes, mainBytes } for the db, or null if missing.
function walStatus(dbPath) {
  try {
    const main = fs.statSync(dbPath).size;
    const wal = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
    const shm = fs.existsSync(dbPath + '-shm') ? fs.statSync(dbPath + '-shm').size : 0;
    return { mainBytes: main, walBytes: wal, shmBytes: shm };
  } catch { return null; }
}

// Fold the WAL into the main db so read-only connections can see all history.
// ONLY call this when ZCode is NOT running (verified by caller).
// Returns { ok, before, after, checkpointed }.
function checkpointNow(dbPath) {
  const before = walStatus(dbPath);
  let db;
  try {
    // Writable connection: opening it lets SQLite recover the WAL journal,
    // then TRUNCATE checkpoint folds it into the main db and zeroes the -wal.
    db = new Database(dbPath, { timeout: 10000 });
    db.pragma('busy_timeout = 10000');
    // TRUNCATE = checkpoint as much as possible, then truncate -wal to 0.
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    // result is [busy, log_frames, checkpointed_frames]
    const after = walStatus(dbPath);
    return {
      ok: true,
      before,
      after,
      busy: Array.isArray(result) ? result[0] : null,
      checkpointed: Array.isArray(result) ? result[2] : null,
    };
  } catch (e) {
    return { ok: false, error: e.message, before };
  } finally {
    try { if (db) db.close(); } catch {}
  }
}

module.exports = { isZCodeRunning, walStatus, checkpointNow };
