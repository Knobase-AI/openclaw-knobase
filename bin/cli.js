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
  'mention': 'mention.js',
  'workspace': 'workspace.js',
  'docs': null, // routed to docs subcommands
  'agents': null, // routed to agents subcommands
};

const AGENTS_SUBCOMMANDS = {
  'list': { script: 'agents/list.js', desc: 'List all agents in the workspace' },
  'info': { script: 'agents/info.js', desc: 'Get current agent\'s profile information' },
  'find': { script: 'agents/find.js', desc: 'Find collaborators by capability or expertise' },
};

const DOCS_SUBCOMMANDS = {
  'list':   { script: 'docs/list.js',   desc: 'List all documents in the workspace' },
  'read':   { script: 'docs/read.js',   desc: 'Read a specific document by ID' },
  'search': { script: 'docs/search.js', desc: 'Search documents by query' },
  'create': { script: 'docs/create.js', desc: 'Create a new document' },
  'write':  { script: 'docs/write.js',  desc: 'Edit a document with block operations' },
  'delete': { script: 'docs/delete.js', desc: 'Delete a document by ID' },
  'export': { script: 'docs/export.js', desc: 'Export a document to PNG/JPEG/PDF' },
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
  console.log(chalk.gray('  docs       Manage workspace documents (list, read, search, create, write, delete, export)'));
  console.log(chalk.gray('  agents     Manage workspace agents (list, info, find)'));
  console.log(chalk.gray('  workspace  Show workspace information'));
  console.log(chalk.gray('  mention    Create a @mention in a document'));
  console.log(chalk.gray('  --help     Show this help message\n'));
  console.log(chalk.gray('Run "openclaw knobase docs --help" for document subcommands.'));
  console.log(chalk.gray('Run "openclaw knobase agents --help" for agent subcommands.'));
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
  console.log(chalk.gray('  write <id> <op> <content>        Edit a document with block operations'));
  console.log(chalk.gray('  delete <id> [--force]            Delete a document by ID'));
  console.log(chalk.gray('  export <id> [--format <fmt>]     Export a document to PNG/JPEG/PDF'));
  console.log(chalk.gray('  --help                           Show this help message\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  openclaw knobase docs list'));
  console.log(chalk.gray('  openclaw knobase docs read abc123'));
  console.log(chalk.gray('  openclaw knobase docs search "project roadmap"'));
  console.log(chalk.gray('  openclaw knobase docs create "Meeting Notes" --content "Agenda items"'));
  console.log(chalk.gray('  openclaw knobase docs write abc123 append "New paragraph"'));
  console.log(chalk.gray('  openclaw knobase docs delete abc123'));
  console.log(chalk.gray('  openclaw knobase docs export abc123 --format png'));
  process.exit(0);
}

function showAgentsHelp() {
  console.log(chalk.blue.bold('Knobase Agent Commands\n'));
  console.log(chalk.white('Usage: openclaw knobase agents <subcommand>\n'));
  console.log(chalk.white('Subcommands:'));
  console.log(chalk.gray('  list                  List all agents in the workspace'));
  console.log(chalk.gray('  info                  Get current agent\'s profile information'));
  console.log(chalk.gray('  find <query>          Find collaborators by capability or expertise'));
  console.log(chalk.gray('  --help                Show this help message\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  openclaw knobase agents list'));
  console.log(chalk.gray('  openclaw knobase agents info'));
  console.log(chalk.gray('  openclaw knobase agents find "code review"'));
  console.log(chalk.gray('  openclaw knobase agents find python backend'));
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
} else if (command === 'agents') {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    showAgentsHelp();
  }

  if (!(subcommand in AGENTS_SUBCOMMANDS)) {
    console.error(chalk.red(`Unknown agents subcommand: ${subcommand}`));
    console.log(chalk.gray('Run "openclaw knobase agents --help" for available subcommands'));
    process.exit(1);
  }

  const scriptPath = path.join(__dirname, AGENTS_SUBCOMMANDS[subcommand].script);
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
