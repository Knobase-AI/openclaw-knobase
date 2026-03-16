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
  'setup': 'setup.js',
  'docs': null, // routed to docs subcommands
};

const DOCS_SUBCOMMANDS = {
  'list':   { script: 'docs/list.js',   desc: 'List all documents in the workspace' },
  'read':   { script: 'docs/read.js',   desc: 'Read a specific document by ID' },
  'search': { script: 'docs/search.js', desc: 'Search documents by query' },
  'create': { script: 'docs/create.js', desc: 'Create a new document' },
};

const command = process.argv[2];
const args = process.argv.slice(3);

function showMainHelp() {
  console.log(chalk.blue.bold('Knobase Integration for OpenClaw\n'));
  console.log(chalk.white('Usage: openclaw knobase <command>\n'));
  console.log(chalk.white('Commands:'));
  console.log(chalk.gray('  auth       Authenticate and register agent'));
  console.log(chalk.gray('  configure  Auto-configure (verify key, save .env, register webhook)'));
  console.log(chalk.gray('  connect    One-click agent connection (--code <user_code>)'));
  console.log(chalk.gray('  status     Check connection status'));
  console.log(chalk.gray('  webhook    Start webhook server'));
  console.log(chalk.gray('  setup      One-command auth + webhook start (--auto, --doc <url>)'));
  console.log(chalk.gray('  docs       Manage workspace documents (list, read, search, create)'));
  console.log(chalk.gray('  --help     Show this help message\n'));
  console.log(chalk.gray('Run "openclaw knobase docs --help" for document subcommands.'));
  process.exit(0);
}

function showDocsHelp() {
  console.log(chalk.blue.bold('Knobase Document Commands\n'));
  console.log(chalk.white('Usage: openclaw knobase docs <subcommand>\n'));
  console.log(chalk.white('Subcommands:'));
  console.log(chalk.gray('  list                             List all documents in the workspace'));
  console.log(chalk.gray('  read <id>                        Read a specific document by ID'));
  console.log(chalk.gray('  search <query>                   Search documents by query'));
  console.log(chalk.gray('  create <title> [--content <c>]   Create a new document'));
  console.log(chalk.gray('  --help                           Show this help message\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  openclaw knobase docs list'));
  console.log(chalk.gray('  openclaw knobase docs read abc123'));
  console.log(chalk.gray('  openclaw knobase docs search "project roadmap"'));
  console.log(chalk.gray('  openclaw knobase docs create "Meeting Notes" --content "Agenda items"'));
  process.exit(0);
}

if (!command || command === '--help' || command === '-h') {
  showMainHelp();
}

if (!(command in COMMANDS)) {
  console.error(chalk.red(`Unknown command: ${command}`));
  console.log(chalk.gray('Run "openclaw knobase --help" for available commands'));
  process.exit(1);
}

if (command === 'docs') {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    showDocsHelp();
  }

  if (!(subcommand in DOCS_SUBCOMMANDS)) {
    console.error(chalk.red(`Unknown docs subcommand: ${subcommand}`));
    console.log(chalk.gray('Run "openclaw knobase docs --help" for available subcommands'));
    process.exit(1);
  }

  const scriptPath = path.join(__dirname, DOCS_SUBCOMMANDS[subcommand].script);
  const child = spawn('node', [scriptPath, ...subArgs], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  child.on('exit', (code) => {
    process.exit(code);
  });
} else {
  const script = COMMANDS[command];

  if (command === 'auth') {
    const firstArg = args[0];
    if (firstArg && firstArg.startsWith('kb_') && !args.includes('--api-key')) {
      args.splice(0, 1, '--api-key', firstArg);
    }
  }

  if (script === null) {
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
}
