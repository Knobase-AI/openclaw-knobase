#!/usr/bin/env node

/**
 * Export a document to PNG, JPEG, or PDF.
 *
 * Usage: knobase docs export <document-id> [--format <png|jpeg|pdf>] [--output <path>]
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const VALID_FORMATS = ['png', 'jpeg', 'pdf'];

async function loadConfig() {
  try {
    const content = await fsPromises.readFile(ENV_FILE, 'utf8');
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

function parseArgs(argv) {
  const args = argv.slice(2);
  let documentId = null;
  let format = 'pdf';
  let output = null;

  let i = 0;
  while (i < args.length) {
    if (args[i] === '--format' && args[i + 1]) {
      format = args[++i];
      i++;
      continue;
    }
    if (args[i] === '--output' && args[i + 1]) {
      output = args[++i];
      i++;
      continue;
    }
    if (args[i].startsWith('--')) {
      i++;
      continue;
    }
    if (!documentId) {
      documentId = args[i];
    }
    i++;
  }

  return { documentId, format: format.toLowerCase(), output };
}

async function exportDocument(documentId, format, outputPath) {
  console.log(chalk.blue.bold('\n📄 Knobase Export Document\n'));

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

  console.log(chalk.gray('Requesting export...'));

  const exportUrl = `${baseUrl}/api/mcp/tools/document/export`;
  let exportResponse;
  try {
    exportResponse = await fetch(exportUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        documentId,
        format,
      }),
    });
  } catch (err) {
    console.error(chalk.red(`✗ Network error: ${err.message}`));
    process.exit(1);
  }

  if (exportResponse.status === 404) {
    console.error(chalk.red(`✗ Document not found: ${documentId}`));
    process.exit(1);
  }

  if (exportResponse.status === 401 || exportResponse.status === 403) {
    console.error(chalk.red('✗ Access denied. Check your API key and permissions.'));
    process.exit(1);
  }

  if (!exportResponse.ok) {
    const body = await exportResponse.text().catch(() => '');
    console.error(chalk.red(`✗ Export failed (HTTP ${exportResponse.status}): ${body || exportResponse.statusText}`));
    process.exit(1);
  }

  const exportData = await exportResponse.json();
  const downloadUrl = exportData.url ?? exportData.downloadUrl ?? exportData.data?.url ?? exportData.result?.url;

  if (!downloadUrl) {
    console.error(chalk.red('✗ No download URL returned from export API.'));
    console.error(chalk.gray('  Response: ' + JSON.stringify(exportData).slice(0, 200)));
    process.exit(1);
  }

  console.log(chalk.gray('Downloading file...'));

  let fileResponse;
  try {
    fileResponse = await fetch(downloadUrl);
  } catch (err) {
    console.error(chalk.red(`✗ Download failed: ${err.message}`));
    process.exit(1);
  }

  if (!fileResponse.ok) {
    console.error(chalk.red(`✗ Download failed (HTTP ${fileResponse.status}): ${fileResponse.statusText}`));
    process.exit(1);
  }

  const defaultFilename = `${documentId}.${format}`;
  let destPath;

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    try {
      const stat = await fsPromises.stat(resolved);
      if (stat.isDirectory()) {
        destPath = path.join(resolved, defaultFilename);
      } else {
        destPath = resolved;
      }
    } catch {
      destPath = resolved;
    }
  } else {
    destPath = path.resolve(defaultFilename);
  }

  const destDir = path.dirname(destPath);
  await fsPromises.mkdir(destDir, { recursive: true });

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  await fsPromises.writeFile(destPath, buffer);

  const stat = await fsPromises.stat(destPath);
  const sizeKb = (stat.size / 1024).toFixed(1);

  const divider = chalk.gray('─'.repeat(50));
  console.log('');
  console.log(chalk.green.bold('✓ Document exported successfully'));
  console.log(divider);
  console.log(chalk.gray('Document: ') + chalk.cyan(documentId));
  console.log(chalk.gray('Format:   ') + chalk.white(format.toUpperCase()));
  console.log(chalk.gray('File:     ') + chalk.white(destPath));
  console.log(chalk.gray('Size:     ') + chalk.white(`${sizeKb} KB`));
  console.log(divider);
  console.log('');
}

function showHelp() {
  console.log(chalk.blue.bold('Export a Knobase document to PNG, JPEG, or PDF\n'));
  console.log(chalk.white('Usage: knobase docs export <document-id> [--format <png|jpeg|pdf>] [--output <path>]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --format <fmt>   Export format: png, jpeg, or pdf (default: pdf)'));
  console.log(chalk.gray('  --output <path>  Output file path or directory (default: current directory)\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  knobase docs export abc123'));
  console.log(chalk.gray('  knobase docs export abc123 --format png'));
  console.log(chalk.gray('  knobase docs export abc123 --format jpeg --output ./exports/'));
  console.log(chalk.gray('  knobase docs export abc123 --output report.pdf\n'));
  process.exit(0);
}

// --- Entry point ---

const { documentId, format, output } = parseArgs(process.argv);

if (!documentId || documentId === '--help' || documentId === '-h' || process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
}

if (!VALID_FORMATS.includes(format)) {
  console.error(chalk.red(`✗ Invalid format: ${format}`));
  console.log(chalk.gray(`  Valid formats: ${VALID_FORMATS.join(', ')}`));
  process.exit(1);
}

exportDocument(documentId, format, output).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
