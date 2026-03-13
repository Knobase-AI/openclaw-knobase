#!/usr/bin/env node

/**
 * OpenClaw Knobase CLI Entry Point
 * 
 * Usage: openclaw knobase [command]
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  'auth': 'auth.js',
  'configure': null, // handled inline via src/index.js runConfigure
  'connect': 'connect.js',
  'status': 'status.js',
  'webhook': 'webhook.js',
  'setup': 'setup.js'
};

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command || command === '--help' || command === '-h') {
  console.log(chalk.blue.bold('Knobase Integration for OpenClaw\n'));
  console.log(chalk.white('Usage: openclaw knobase <command>\n'));
  console.log(chalk.white('Commands:'));
  console.log(chalk.gray('  auth       Authenticate and register agent'));
  console.log(chalk.gray('  configure  Auto-configure (verify key, save .env, register webhook)'));
  console.log(chalk.gray('  connect    Connect to a Knobase workspace'));
  console.log(chalk.gray('  status     Check connection status'));
  console.log(chalk.gray('  webhook    Start webhook server'));
  console.log(chalk.gray('  setup      Run setup/installation'));
  console.log(chalk.gray('  --help     Show this help message\n'));
  process.exit(0);
}

if (!(command in COMMANDS)) {
  console.error(chalk.red(`Unknown command: ${command}`));
  console.log(chalk.gray('Run "openclaw knobase --help" for available commands'));
  process.exit(1);
}

const script = COMMANDS[command];

if (command === 'auth') {
  const firstArg = args[0];
  if (firstArg && firstArg.startsWith('kb_') && !args.includes('--api-key')) {
    args.splice(0, 1, '--api-key', firstArg);
  }
}

if (script === null) {
  // Inline commands handled via src/index.js exports
  if (command === 'configure') {
    const { runConfigure } = await import('../src/index.js');
    await runConfigure();
  }
} else {
  const scriptPath = path.join(__dirname, script);
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  child.on('exit', (code) => {
    process.exit(code);
  });
}
