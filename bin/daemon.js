#!/usr/bin/env node

/**
 * Knobase Sync Daemon
 *
 * Background process that keeps the local OpenClaw workspace in sync with
 * Knobase cloud. Watches local files via chokidar, polls the remote API for
 * changes, and queues uploads when offline.
 *
 * Usage:
 *   openclaw-knobase daemon start   — start the daemon
 *   openclaw-knobase daemon stop    — stop a running daemon
 *   openclaw-knobase daemon status  — check if the daemon is running
 */

import fs from 'fs/promises';
import { createWriteStream, existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import chokidar from 'chokidar';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const KNOBASE_DIR = path.join(os.homedir(), '.openclaw', 'skills', 'knobase');
const PID_FILE = path.join(KNOBASE_DIR, 'daemon.pid');
const LOG_DIR = path.join(KNOBASE_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'daemon.log');
const QUEUE_FILE = path.join(KNOBASE_DIR, 'sync-queue.json');

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 5000;
const RETRY_INTERVAL_MS = 10000;
const MAX_RETRY_ATTEMPTS = 10;

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfigSync() {
  try {
    const content = readFileSync(ENV_FILE, 'utf8');
    const config = {};
    for (const line of content.split('\n')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    }
    return config;
  } catch {
    return {};
  }
}

async function loadConfig() {
  try {
    const content = await fs.readFile(ENV_FILE, 'utf8');
    const config = {};
    for (const line of content.split('\n')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    }
    return config;
  } catch {
    return {};
  }
}

// ─── Logger ───────────────────────────────────────────────────────────────────

class Logger {
  #stream = null;

  async init() {
    await fs.mkdir(LOG_DIR, { recursive: true });
    this.#stream = createWriteStream(LOG_FILE, { flags: 'a' });
  }

  #write(level, message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}\n`;
    if (this.#stream) this.#stream.write(line);
  }

  info(msg)  { this.#write('INFO', msg); }
  warn(msg)  { this.#write('WARN', msg); }
  error(msg) { this.#write('ERROR', msg); }

  close() {
    if (this.#stream) {
      this.#stream.end();
      this.#stream = null;
    }
  }
}

// ─── SyncQueue — persists pending uploads for offline resilience ──────────────

class SyncQueue {
  #items = [];
  #logger;

  constructor(logger) {
    this.#logger = logger;
  }

  async load() {
    try {
      const raw = await fs.readFile(QUEUE_FILE, 'utf8');
      this.#items = JSON.parse(raw);
      this.#logger.info(`Loaded ${this.#items.length} queued item(s) from disk`);
    } catch {
      this.#items = [];
    }
  }

  async save() {
    await fs.mkdir(KNOBASE_DIR, { recursive: true });
    await fs.writeFile(QUEUE_FILE, JSON.stringify(this.#items, null, 2));
  }

  enqueue(entry) {
    const existing = this.#items.findIndex(i => i.relativePath === entry.relativePath);
    if (existing !== -1) {
      this.#items[existing] = entry;
    } else {
      this.#items.push(entry);
    }
    this.save().catch(() => {});
  }

  dequeue() {
    return this.#items.shift() ?? null;
  }

  peek() {
    return this.#items[0] ?? null;
  }

  get length() {
    return this.#items.length;
  }

  clear() {
    this.#items = [];
    this.save().catch(() => {});
  }
}

// ─── FileWatcher — debounced local change detection ───────────────────────────

class FileWatcher {
  #watcher = null;
  #debounceTimers = new Map();
  #onChange;
  #logger;
  #watchDir;

  constructor(watchDir, onChange, logger) {
    this.#watchDir = watchDir;
    this.#onChange = onChange;
    this.#logger = logger;
  }

  async start() {
    await fs.mkdir(this.#watchDir, { recursive: true });

    this.#watcher = chokidar.watch(this.#watchDir, {
      ignoreInitial: true,
      ignored: [/(^|[/\\])\./],
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.#watcher.on('add', (fp) => this.#handle('add', fp));
    this.#watcher.on('change', (fp) => this.#handle('change', fp));
    this.#watcher.on('unlink', (fp) => this.#handle('unlink', fp));

    this.#logger.info(`Watching ${this.#watchDir}`);
  }

  #handle(event, filePath) {
    const relative = path.relative(this.#watchDir, filePath);

    if (this.#debounceTimers.has(relative)) {
      clearTimeout(this.#debounceTimers.get(relative));
    }

    const timer = setTimeout(() => {
      this.#debounceTimers.delete(relative);
      this.#logger.info(`Local ${event}: ${relative}`);
      this.#onChange(event, relative, filePath);
    }, DEBOUNCE_MS);

    this.#debounceTimers.set(relative, timer);
  }

  stop() {
    if (this.#watcher) {
      this.#watcher.close();
      this.#watcher = null;
    }
    for (const timer of this.#debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.#debounceTimers.clear();
    this.#logger.info('FileWatcher stopped');
  }
}

// ─── CloudPoller — periodically checks remote for changes ─────────────────────

class CloudPoller {
  #interval = null;
  #lastPollTimestamp = null;
  #config;
  #workspaceDir;
  #logger;
  #onOnline;
  #onOffline;
  #conflictStrategy;

  constructor(config, workspaceDir, logger, { onOnline, onOffline, conflictStrategy = 'cloud' } = {}) {
    this.#config = config;
    this.#workspaceDir = workspaceDir;
    this.#logger = logger;
    this.#onOnline = onOnline ?? (() => {});
    this.#onOffline = onOffline ?? (() => {});
    this.#conflictStrategy = conflictStrategy;
  }

  start() {
    this.#lastPollTimestamp = new Date().toISOString();
    this.#poll();
    this.#interval = setInterval(() => this.#poll(), POLL_INTERVAL_MS);
    this.#logger.info(`CloudPoller started (every ${POLL_INTERVAL_MS / 1000}s, conflict=${this.#conflictStrategy})`);
  }

  async #poll() {
    const { KNOBASE_API_KEY: apiKey, KNOBASE_API_ENDPOINT: baseUrl, AGENT_ID: agentId } = this.#config;
    if (!apiKey || !agentId) return;

    const endpoint = `${baseUrl || 'https://app.knobase.com'}/api/agents/${encodeURIComponent(agentId)}/sync/changes`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ since: this.#lastPollTimestamp }),
      });

      if (!response.ok) {
        this.#logger.warn(`Poll returned ${response.status}`);
        return;
      }

      const data = await response.json();
      this.#lastPollTimestamp = new Date().toISOString();
      this.#onOnline();

      const changes = data.changes ?? data.files ?? [];
      if (changes.length === 0) return;

      this.#logger.info(`Remote: ${changes.length} changed file(s)`);

      for (const file of changes) {
        await this.#applyRemoteChange(file);
      }
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.type === 'system') {
        this.#logger.warn(`Offline: ${err.message}`);
        this.#onOffline();
      } else {
        this.#logger.error(`Poll error: ${err.message}`);
      }
    }
  }

  async #applyRemoteChange(file) {
    const filePath = path.join(this.#workspaceDir, file.path);
    const dir = path.dirname(filePath);

    if (file.deleted) {
      try {
        await fs.unlink(filePath);
        this.#logger.info(`Deleted local: ${file.path}`);
      } catch {
        // already gone
      }
      return;
    }

    let localContent = null;
    try {
      localContent = await fs.readFile(filePath, 'utf8');
    } catch {
      // file doesn't exist locally yet
    }

    if (localContent !== null && localContent !== file.content) {
      if (this.#conflictStrategy === 'cloud') {
        this.#logger.info(`Conflict on ${file.path} — cloud wins`);
      } else if (this.#conflictStrategy === 'local') {
        this.#logger.info(`Conflict on ${file.path} — local wins, skipping download`);
        return;
      } else if (this.#conflictStrategy === 'skip') {
        this.#logger.info(`Conflict on ${file.path} — skipping`);
        return;
      }
    }

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
    this.#logger.info(`Downloaded: ${file.path}`);
  }

  stop() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = null;
    }
    this.#logger.info('CloudPoller stopped');
  }
}

// ─── Daemon ───────────────────────────────────────────────────────────────────

class Daemon {
  #logger = new Logger();
  #queue;
  #watcher;
  #poller;
  #retryTimer = null;
  #online = true;
  #config;
  #workspaceDir;

  constructor() {
    this.#queue = new SyncQueue(this.#logger);
  }

  async start() {
    this.#config = await loadConfig();
    this.#workspaceDir = this.#config.OPENCLAW_AGENT_WORKSPACE
      || path.join(os.homedir(), '.openclaw', 'workspace');

    await this.#logger.init();
    await this.#queue.load();
    await this.#writePid();

    this.#logger.info('Daemon starting');
    this.#logger.info(`Workspace: ${this.#workspaceDir}`);
    this.#logger.info(`Agent: ${this.#config.AGENT_ID || '(none)'}`);

    const conflictStrategy = this.#config.KNOBASE_CONFLICT_STRATEGY || 'cloud';

    this.#watcher = new FileWatcher(
      this.#workspaceDir,
      (event, relative, absolute) => this.#handleLocalChange(event, relative, absolute),
      this.#logger,
    );
    await this.#watcher.start();

    this.#poller = new CloudPoller(this.#config, this.#workspaceDir, this.#logger, {
      onOnline: () => this.#handleOnline(),
      onOffline: () => this.#handleOffline(),
      conflictStrategy,
    });
    this.#poller.start();

    this.#drainQueue();

    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());

    this.#logger.info('Daemon running');
  }

  async stop() {
    this.#logger.info('Daemon stopping');

    if (this.#watcher) this.#watcher.stop();
    if (this.#poller) this.#poller.stop();
    if (this.#retryTimer) clearTimeout(this.#retryTimer);

    await this.#queue.save();
    await this.#removePid();
    this.#logger.info('Daemon stopped');
    this.#logger.close();

    process.exit(0);
  }

  // --- Local change handler ---

  async #handleLocalChange(event, relativePath, absolutePath) {
    const { KNOBASE_API_KEY: apiKey, KNOBASE_API_ENDPOINT: baseUrl, AGENT_ID: agentId } = this.#config;
    if (!apiKey || !agentId) return;

    let content = null;
    if (event !== 'unlink') {
      try {
        content = await fs.readFile(absolutePath, 'utf8');
      } catch {
        this.#logger.warn(`Could not read ${relativePath} for upload`);
        return;
      }
    }

    const entry = {
      relativePath,
      content,
      deleted: event === 'unlink',
      timestamp: new Date().toISOString(),
      attempts: 0,
    };

    if (!this.#online) {
      this.#logger.info(`Offline — queuing ${relativePath}`);
      this.#queue.enqueue(entry);
      return;
    }

    const success = await this.#upload(entry, baseUrl, agentId, apiKey);
    if (!success) {
      this.#queue.enqueue(entry);
    }
  }

  async #upload(entry, baseUrl, agentId, apiKey) {
    const endpoint = `${baseUrl || 'https://app.knobase.com'}/api/agents/${encodeURIComponent(agentId)}/sync/upload`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          path: entry.relativePath,
          content: entry.content,
          deleted: entry.deleted,
          timestamp: entry.timestamp,
        }),
      });

      if (!response.ok) {
        this.#logger.warn(`Upload failed for ${entry.relativePath}: ${response.status}`);
        return false;
      }

      this.#logger.info(`Uploaded: ${entry.relativePath}`);
      return true;
    } catch (err) {
      this.#logger.warn(`Upload error for ${entry.relativePath}: ${err.message}`);
      return false;
    }
  }

  // --- Queue drain / retry ---

  async #drainQueue() {
    if (this.#queue.length === 0) return;

    const { KNOBASE_API_KEY: apiKey, KNOBASE_API_ENDPOINT: baseUrl, AGENT_ID: agentId } = this.#config;
    if (!apiKey || !agentId) return;

    this.#logger.info(`Draining queue (${this.#queue.length} item(s))`);

    while (this.#queue.length > 0) {
      const entry = this.#queue.peek();
      if (!entry) break;

      if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
        this.#logger.warn(`Giving up on ${entry.relativePath} after ${MAX_RETRY_ATTEMPTS} attempts`);
        this.#queue.dequeue();
        continue;
      }

      entry.attempts = (entry.attempts || 0) + 1;
      const success = await this.#upload(entry, baseUrl, agentId, apiKey);

      if (success) {
        this.#queue.dequeue();
      } else {
        this.#scheduleRetry();
        return;
      }
    }

    if (this.#queue.length === 0) {
      this.#logger.info('Queue drained');
    }
  }

  #scheduleRetry() {
    if (this.#retryTimer) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#drainQueue();
    }, RETRY_INTERVAL_MS);
  }

  // --- Online / offline ---

  #handleOnline() {
    if (!this.#online) {
      this.#online = true;
      this.#logger.info('Back online');
      this.#drainQueue();
    }
  }

  #handleOffline() {
    if (this.#online) {
      this.#online = false;
      this.#logger.warn('Gone offline — uploads will be queued');
    }
  }

  // --- PID management ---

  async #writePid() {
    await fs.mkdir(KNOBASE_DIR, { recursive: true });
    await fs.writeFile(PID_FILE, String(process.pid));
    this.#logger.info(`PID ${process.pid} written to ${PID_FILE}`);
  }

  async #removePid() {
    try {
      await fs.unlink(PID_FILE);
    } catch {
      // already removed
    }
  }

  // --- Static helpers for CLI commands ---

  static readPid() {
    try {
      const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (isNaN(pid)) return null;
      return pid;
    } catch {
      return null;
    }
  }

  static isRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

// ─── CLI interface ────────────────────────────────────────────────────────────

const subcommand = process.argv[2];

if (subcommand === 'start') {
  const foreground = process.argv.includes('--foreground') || process.argv.includes('-f');

  if (foreground) {
    const daemon = new Daemon();
    daemon.start().catch((err) => {
      console.error(chalk.red(`Daemon failed: ${err.message}`));
      process.exit(1);
    });
  } else {
    const existingPid = Daemon.readPid();
    if (existingPid && Daemon.isRunning(existingPid)) {
      console.log(chalk.yellow(`  Daemon already running (PID ${existingPid})`));
      process.exit(0);
    }

    await fs.mkdir(LOG_DIR, { recursive: true });

    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'start', '--foreground'], {
      detached: true,
      stdio: 'ignore',
      cwd: SKILL_DIR,
    });
    child.unref();

    await new Promise((r) => setTimeout(r, 1000));

    const pid = Daemon.readPid();
    if (pid && Daemon.isRunning(pid)) {
      console.log(chalk.green(`  ✓ Daemon started (PID ${pid})`));
      console.log(chalk.gray(`  Logs: ${LOG_FILE}`));
    } else {
      console.error(chalk.red('  ✗ Daemon failed to start'));
      console.log(chalk.gray(`  Check logs: ${LOG_FILE}`));
      process.exit(1);
    }
  }
} else if (subcommand === 'stop') {
  const pid = Daemon.readPid();
  if (!pid) {
    console.log(chalk.yellow('  Daemon is not running (no PID file)'));
    process.exit(0);
  }

  if (!Daemon.isRunning(pid)) {
    console.log(chalk.yellow(`  Daemon PID ${pid} is not running (stale PID file)`));
    try { await fs.unlink(PID_FILE); } catch { /* ignore */ }
    process.exit(0);
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(chalk.green(`  ✓ Sent SIGTERM to daemon (PID ${pid})`));
  } catch (err) {
    console.error(chalk.red(`  ✗ Could not stop daemon: ${err.message}`));
    process.exit(1);
  }
} else if (subcommand === 'status') {
  const pid = Daemon.readPid();
  if (!pid) {
    console.log(chalk.yellow('  Daemon: not running'));
    process.exit(0);
  }

  if (Daemon.isRunning(pid)) {
    console.log(chalk.green(`  Daemon: running (PID ${pid})`));

    const config = loadConfigSync();
    const workspace = config.OPENCLAW_AGENT_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
    console.log(chalk.gray(`  Workspace: ${workspace}`));
    console.log(chalk.gray(`  Logs: ${LOG_FILE}`));

    let queueCount = 0;
    try {
      const raw = readFileSync(QUEUE_FILE, 'utf8');
      queueCount = JSON.parse(raw).length;
    } catch { /* empty queue */ }

    if (queueCount > 0) {
      console.log(chalk.yellow(`  Queued uploads: ${queueCount}`));
    }
  } else {
    console.log(chalk.yellow(`  Daemon: not running (stale PID ${pid})`));
    try { await fs.unlink(PID_FILE); } catch { /* ignore */ }
  }
} else {
  console.log(chalk.blue.bold('\n  Knobase Sync Daemon\n'));
  console.log(chalk.white('  Usage: openclaw-knobase daemon <command>\n'));
  console.log(chalk.white('  Commands:'));
  console.log(chalk.gray('    start              Start the sync daemon'));
  console.log(chalk.gray('    start --foreground  Run in the foreground (for debugging)'));
  console.log(chalk.gray('    stop               Stop the running daemon'));
  console.log(chalk.gray('    status             Check daemon status\n'));
  console.log(chalk.white('  Configuration (.env):'));
  console.log(chalk.gray('    KNOBASE_CONFLICT_STRATEGY   cloud | local | skip (default: cloud)\n'));
  console.log(chalk.gray(`  PID file: ${PID_FILE}`));
  console.log(chalk.gray(`  Log file: ${LOG_FILE}\n`));
}
