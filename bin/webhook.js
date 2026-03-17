#!/usr/bin/env node

/**
 * Knobase Webhook Server
 * 
 * Receives webhooks from Knobase and triggers OpenClaw agent processing
 * 
 * Usage: openclaw knobase webhook start [--port 3456] [--daemon]
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { mountWebhookHandler } from '../src/webhook-handler.js';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const ENV_FILE = path.join(SKILL_DIR, '.env');

let config = null;

/**
 * Load configuration from .env file
 */
async function loadConfig() {
  try {
    const content = await fs.readFile(ENV_FILE, 'utf8');
    config = {};
    content.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    });
    return config;
  } catch {
    return null;
  }
}

/**
 * Error handling middleware
 */
function errorHandler(err, req, res, next) {
  console.error(chalk.red('[Server] Unhandled error:'), err.message);
  console.error(chalk.gray(err.stack));

  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
}

/**
 * Request logging middleware
 */
function requestLogger(req, res, next) {
  const timestamp = new Date().toISOString();
  const method = chalk.cyan(req.method);
  const url = chalk.white(req.path);
  
  console.log(chalk.gray(`[${timestamp}]`) + ` ${method} ${url}`);
  
  // Log response time on finish
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode < 400 ? chalk.green(res.statusCode) : chalk.red(res.statusCode);
    console.log(chalk.gray(`[${timestamp}]`) + ` ${status} ${chalk.gray(`${duration}ms`)}`);
  });
  
  next();
}

/**
 * Webhook logging middleware
 */
function webhookLogger(req, res, next) {
  if (req.path === '/webhook/knobase') {
    console.log(chalk.magenta('\n' + '='.repeat(60)));
    console.log(chalk.magenta.bold('  INCOMING WEBHOOK FROM KNOBASE'));
    console.log(chalk.magenta('='.repeat(60)));
    console.log(chalk.white('Timestamp:'), new Date().toISOString());
    console.log(chalk.white('IP:'), req.ip || req.connection.remoteAddress);
    console.log(chalk.white('Headers:'));
    Object.entries(req.headers).forEach(([key, value]) => {
      if (key.toLowerCase().includes('knobase') || key.toLowerCase() === 'content-type') {
        console.log(chalk.gray(`  ${key}:`), value);
      }
    });
    console.log(chalk.magenta('='.repeat(60) + '\n'));
  }
  next();
}

/**
 * Start the webhook server
 */
async function startServer(port = 3456) {
  await loadConfig();

  if (!config || !config.AGENT_ID) {
    console.error(chalk.red('❌ Not authenticated. Run: openclaw knobase auth'));
    process.exit(1);
  }

  const app = express();

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger);
  app.use(webhookLogger);

  // Health check endpoint (basic GET)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      agent: config.AGENT_ID,
      timestamp: new Date().toISOString(),
      version: pkg.version
    });
  });

  // Health check endpoint for Knobase presence verification (POST)
  app.post('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      agent_id: config.AGENT_ID,
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: pkg.version
    });
  });

  // Status endpoint (more detailed)
  app.get('/status', (req, res) => {
    res.json({
      status: 'running',
      agent: config.AGENT_ID,
      workspace: config.KNOBASE_WORKSPACE_ID,
      webhookConfigured: !!config.KNOBASE_WEBHOOK_SECRET,
      mcpEndpoint: config.KNOBASE_MCP_ENDPOINT || 'from payload',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Mount the Knobase webhook handler
  mountWebhookHandler(app, '/webhook/knobase', {
    webhookSecret: config.KNOBASE_WEBHOOK_SECRET
  });

  // Legacy endpoint for backward compatibility
  app.post('/webhook', async (req, res) => {
    console.log(chalk.yellow('[Webhook] Legacy endpoint used, redirecting to /webhook/knobase'));
    res.redirect(307, '/webhook/knobase');
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
      timestamp: new Date().toISOString()
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  // Start listening
  const server = app.listen(port, () => {
    console.log('\n' + chalk.green.bold('🚀 Knobase Webhook Server Started'));
    console.log(chalk.white('─'.repeat(40)));
    console.log(chalk.white('Agent ID:     ') + chalk.cyan(config.AGENT_ID));
    console.log(chalk.white('Port:         ') + chalk.cyan(port));
    console.log(chalk.white('Webhook URL:  ') + chalk.cyan(`http://localhost:${port}/webhook/knobase`));
    console.log(chalk.white('Health Check: ') + chalk.cyan(`http://localhost:${port}/health`));
    console.log(chalk.white('Status:       ') + chalk.cyan(`http://localhost:${port}/status`));
    console.log(chalk.white('─'.repeat(40)));
    
    if (!config.KNOBASE_WEBHOOK_SECRET) {
      console.log(chalk.yellow('\n⚠️  Warning: KNOBASE_WEBHOOK_SECRET not configured'));
      console.log(chalk.yellow('   Webhook signature verification is disabled\n'));
    } else {
      console.log(chalk.green('\n✓ Webhook signature verification enabled\n'));
    }
    
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(chalk.green(`✓ Webhook server already running on port ${port}`));
      process.exit(0);
    }
    console.error(chalk.red(`❌ Server error: ${err.message}`));
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log(chalk.yellow('\n[Server] SIGTERM received, shutting down...'));
    server.close(() => {
      console.log(chalk.green('[Server] Shut down complete'));
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n[Server] SIGINT received, shutting down...'));
    server.close(() => {
      console.log(chalk.green('[Server] Shut down complete'));
      process.exit(0);
    });
  });

  return server;
}

// Parse arguments
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex !== -1 
  ? parseInt(args[portIndex + 1]) 
  : (process.env.WEBHOOK_PORT || process.env.PORT || 3456);

const daemonIndex = args.indexOf('--daemon');
const isDaemon = daemonIndex !== -1;

if (args[0] === 'start' || args.length === 0) {
  startServer(port);
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
${chalk.bold('Knobase Webhook Server')}

Usage: openclaw knobase webhook start [options]

Options:
  --port <port>   Port to listen on (default: 3456)
  --daemon        Run as daemon (not implemented yet)
  --help, -h      Show this help message

Environment Variables:
  KNOBASE_WEBHOOK_SECRET  Secret for HMAC signature verification
  KNOBASE_MCP_ENDPOINT    Default MCP endpoint (optional, can be in payload)
  WEBHOOK_PORT            Default port (can be overridden with --port)
`);
} else {
  console.log(chalk.red(`Unknown command: ${args[0]}`));
  console.log(chalk.gray('Run with --help for usage information'));
  process.exit(1);
}
