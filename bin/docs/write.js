#!/usr/bin/env node

/**
 * Edit a document with block operations.
 *
 * Usage: knobase docs write <document-id> <operation> <content>
 *
 * Operations: replace, insert-after, insert-before, delete, append, prepend
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const OPERATIONS = ['replace', 'insert-after', 'insert-before', 'delete', 'append', 'prepend'];

async function loadConfig() {
  try {
    const content = await fs.readFile(ENV_FILE, 'utf8');
    const config = {};
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
 * Read the document to retrieve its block IDs.
 */
async function fetchDocument(baseUrl, apiKey, documentId) {
  const url = `${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to read document (HTTP ${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json();
  return data.document ?? data.data ?? data;
}

/**
 * Extract block IDs from a document response.
 * Supports blocks stored as top-level array, nested content array, or body.content.
 */
function extractBlocks(doc) {
  const raw = doc.blocks ?? doc.content?.content ?? doc.body?.content ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(b => b && (b.id || b.block_id))
    .map((b, idx) => ({
      id: b.id ?? b.block_id,
      type: b.type ?? 'unknown',
      index: idx,
      preview: extractPreview(b),
    }));
}

function extractPreview(block) {
  if (typeof block.text === 'string') return block.text.slice(0, 80);
  if (block.content) {
    const texts = [];
    const walk = (node) => {
      if (typeof node === 'string') { texts.push(node); return; }
      if (node.text) texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
      if (Array.isArray(node)) node.forEach(walk);
    };
    walk(block.content);
    return texts.join('').slice(0, 80);
  }
  return '';
}

/**
 * Build the block operation payload for the write_document MCP tool.
 */
function buildOperation(operation, content, blockId) {
  switch (operation) {
    case 'replace':
      if (!blockId) throw new Error('replace requires a block ID (use --block <id>)');
      return {
        type: 'replace_block',
        block_id: blockId,
        content: makeContent(content),
      };

    case 'insert-after':
      if (!blockId) throw new Error('insert-after requires a block ID (use --block <id>)');
      return {
        type: 'insert_after_block',
        block_id: blockId,
        content: makeContent(content),
      };

    case 'insert-before':
      if (!blockId) throw new Error('insert-before requires a block ID (use --block <id>)');
      return {
        type: 'insert_before_block',
        block_id: blockId,
        content: makeContent(content),
      };

    case 'delete':
      if (!blockId) throw new Error('delete requires a block ID (use --block <id>)');
      return {
        type: 'delete_block',
        block_id: blockId,
      };

    case 'append':
      return {
        type: 'append',
        content: makeContent(content),
      };

    case 'prepend':
      return {
        type: 'prepend',
        content: makeContent(content),
      };

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

function makeContent(text) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

/**
 * Call the MCP endpoint to execute a write_document tool invocation.
 */
async function callWriteDocument(baseUrl, apiKey, documentId, operations) {
  const url = `${baseUrl}/api/mcp`;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const body = {
    jsonrpc: '2.0',
    id: requestId,
    method: 'write_document',
    params: {
      document_id: documentId,
      operations: Array.isArray(operations) ? operations : [operations],
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`MCP request failed (HTTP ${response.status}): ${text || response.statusText}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(result.error.message || 'Unknown MCP error');
  }

  return result.result ?? result;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let documentId = null;
  let operation = null;
  let blockId = null;
  const contentParts = [];

  let i = 0;

  if (args[i] && !args[i].startsWith('--')) {
    documentId = args[i++];
  }
  if (args[i] && !args[i].startsWith('--')) {
    operation = args[i++];
  }

  while (i < args.length) {
    if (args[i] === '--block' && args[i + 1]) {
      blockId = args[++i];
      i++;
      continue;
    }
    contentParts.push(args[i]);
    i++;
  }

  const content = contentParts.join(' ').trim() || null;
  return { documentId, operation, content, blockId };
}

function showHelp() {
  console.log(chalk.blue.bold('Edit a Knobase document with block operations\n'));
  console.log(chalk.white('Usage: knobase docs write <document-id> <operation> [content] [--block <id>]\n'));
  console.log(chalk.white('Operations:'));
  console.log(chalk.gray('  replace        Replace a block\'s content          (requires --block)'));
  console.log(chalk.gray('  insert-after   Insert content after a block       (requires --block)'));
  console.log(chalk.gray('  insert-before  Insert content before a block      (requires --block)'));
  console.log(chalk.gray('  delete         Delete a block                     (requires --block)'));
  console.log(chalk.gray('  append         Append content to end of document'));
  console.log(chalk.gray('  prepend        Prepend content to start of document\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --block <id>   Target block ID for the operation\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  knobase docs write abc123 append "New paragraph at the end"'));
  console.log(chalk.gray('  knobase docs write abc123 prepend "First paragraph"'));
  console.log(chalk.gray('  knobase docs write abc123 replace "Updated text" --block blk_01'));
  console.log(chalk.gray('  knobase docs write abc123 insert-after "Inserted below" --block blk_01'));
  console.log(chalk.gray('  knobase docs write abc123 delete --block blk_01'));
  process.exit(0);
}

async function writeDocument(documentId, operation, content, blockId) {
  console.log(chalk.blue.bold('\n✏️  Knobase Write Document\n'));

  const config = await loadConfig();

  if (!config) {
    console.error(chalk.red('✗ Could not load .env config.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  const apiKey = config.KNOBASE_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('✗ KNOBASE_API_KEY is not set in .env'));
    process.exit(1);
  }

  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';

  // Step 1: Read the document to show available blocks
  console.log(chalk.gray('Reading document to resolve blocks...'));

  let doc;
  try {
    doc = await fetchDocument(baseUrl, apiKey, documentId);
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }

  const blocks = extractBlocks(doc);

  if (blocks.length > 0) {
    const divider = chalk.gray('─'.repeat(50));
    console.log(divider);
    console.log(chalk.bold.gray('Document Blocks'));
    console.log(divider);
    for (const b of blocks) {
      const preview = b.preview ? chalk.white(` ${b.preview}`) : '';
      console.log(
        chalk.gray(`  [${b.index}] `) +
        chalk.cyan(b.id) +
        chalk.gray(` (${b.type})`) +
        preview
      );
    }
    console.log(divider);
    console.log('');
  } else {
    console.log(chalk.yellow('  No blocks found in document.'));
    console.log('');
  }

  // Step 2: Build the operation
  let op;
  try {
    op = buildOperation(operation, content, blockId);
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }

  const opLabel = operation.toUpperCase();
  const targetLabel = blockId ? ` on block ${chalk.cyan(blockId)}` : '';
  console.log(chalk.gray(`Executing ${chalk.white(opLabel)}${targetLabel}...`));

  // Step 3: Call the MCP endpoint
  let result;
  try {
    result = await callWriteDocument(baseUrl, apiKey, documentId, [op]);
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }

  // Step 4: Display result
  const divider = chalk.gray('─'.repeat(50));
  console.log('');
  console.log(chalk.green.bold('✓ Document updated successfully'));
  console.log(divider);
  console.log(chalk.gray('Document: ') + chalk.cyan(documentId));
  console.log(chalk.gray('Operation:') + chalk.white(` ${opLabel}`));
  if (blockId) {
    console.log(chalk.gray('Block:    ') + chalk.cyan(blockId));
  }
  if (content && operation !== 'delete') {
    console.log(chalk.gray('Content:  ') + chalk.white(content.length > 60 ? content.slice(0, 60) + '…' : content));
  }
  console.log(divider);
  console.log('');
}

// --- Entry point ---

const { documentId, operation, content, blockId } = parseArgs(process.argv);

if (!documentId || documentId === '--help' || documentId === '-h') {
  showHelp();
}

if (!operation) {
  console.error(chalk.red('✗ Missing operation.'));
  console.log(chalk.gray(`  Valid operations: ${OPERATIONS.join(', ')}`));
  console.log(chalk.gray('  Run: knobase docs write --help'));
  process.exit(1);
}

if (!OPERATIONS.includes(operation)) {
  console.error(chalk.red(`✗ Unknown operation: ${operation}`));
  console.log(chalk.gray(`  Valid operations: ${OPERATIONS.join(', ')}`));
  process.exit(1);
}

if (operation !== 'delete' && !content) {
  console.error(chalk.red(`✗ Content is required for "${operation}" operation.`));
  process.exit(1);
}

writeDocument(documentId, operation, content, blockId).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
