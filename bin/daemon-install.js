#!/usr/bin/env node

/**
 * Knobase Daemon Installer
 * 
 * Installs the Knobase webhook daemon as a system service
 * that auto-starts on boot.
 * 
 * Usage: openclaw-knobase daemon install [--uninstall]
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import os from 'os';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const NODE_PATH = process.execPath;
const WEBHOOK_SCRIPT = path.join(__dirname, 'webhook.js');

const SERVICE_ID = 'com.knobase.daemon';
const SERVICE_LABEL = 'knobase-daemon';

const args = process.argv.slice(2);
const isUninstall = args.includes('--uninstall') || args.includes('uninstall');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  console.log(chalk.blue.bold('Knobase Daemon Installer\n'));
  console.log(chalk.white('Usage: openclaw-knobase daemon install [options]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --uninstall   Remove the daemon service'));
  console.log(chalk.gray('  --help, -h    Show this help message\n'));
  console.log(chalk.white('Supported platforms:'));
  console.log(chalk.gray('  macOS    → launchd (~/Library/LaunchAgents)'));
  console.log(chalk.gray('  Linux    → systemd user service (~/.config/systemd/user)'));
  console.log(chalk.gray('  Windows  → scheduled task\n'));
  process.exit(0);
}

function detectPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  return platform;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (err) {
    return null;
  }
}

function step(label) {
  console.log(chalk.cyan('  →') + ' ' + label);
}

function success(label) {
  console.log(chalk.green('  ✓') + ' ' + label);
}

function warn(label) {
  console.log(chalk.yellow('  ⚠') + ' ' + label);
}

function fail(label) {
  console.log(chalk.red('  ✗') + ' ' + label);
}

// --- macOS: launchd ---

function getMacPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_ID}.plist`);
}

function getMacLogDir() {
  return path.join(os.homedir(), 'Library', 'Logs', 'Knobase');
}

function buildPlist(logDir) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_ID}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${WEBHOOK_SCRIPT}</string>
    <string>start</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${SKILL_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'daemon.log')}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'daemon-error.log')}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>`;
}

async function installMac() {
  console.log(chalk.blue.bold('\n🍎 Installing Knobase daemon (macOS launchd)\n'));

  const plistPath = getMacPlistPath();
  const logDir = getMacLogDir();

  // Unload if already loaded
  run(`launchctl unload "${plistPath}" 2>/dev/null`);

  step('Creating log directory...');
  ensureDir(logDir);
  success(`Log directory: ${chalk.gray(logDir)}`);

  step('Writing launchd plist...');
  const plistContent = buildPlist(logDir);
  ensureDir(path.dirname(plistPath));
  await fs.writeFile(plistPath, plistContent, 'utf8');
  success(`Plist written: ${chalk.gray(plistPath)}`);

  step('Setting file permissions...');
  await fs.chmod(plistPath, 0o644);
  success('Permissions set (644)');

  step('Loading service with launchctl...');
  const loadResult = run(`launchctl load "${plistPath}"`);
  if (loadResult !== null) {
    success('Service loaded and started');
  } else {
    fail('Failed to load service — try manually:');
    console.log(chalk.gray(`    launchctl load "${plistPath}"`));
  }

  console.log(chalk.green.bold('\n✅ Daemon installed successfully!\n'));
  console.log(chalk.white('  The webhook server will now auto-start on login.'));
  console.log(chalk.gray(`  Logs:   ${path.join(logDir, 'daemon.log')}`));
  console.log(chalk.gray(`  Errors: ${path.join(logDir, 'daemon-error.log')}`));
  console.log(chalk.gray(`  Plist:  ${plistPath}\n`));
  console.log(chalk.white('Useful commands:'));
  console.log(chalk.gray(`  launchctl list | grep knobase          # check status`));
  console.log(chalk.gray(`  launchctl unload "${plistPath}"  # stop`));
  console.log(chalk.gray(`  launchctl load "${plistPath}"    # start`));
  console.log('');
}

async function uninstallMac() {
  console.log(chalk.blue.bold('\n🍎 Uninstalling Knobase daemon (macOS launchd)\n'));

  const plistPath = getMacPlistPath();

  step('Unloading service...');
  const result = run(`launchctl unload "${plistPath}"`);
  if (result !== null) {
    success('Service unloaded');
  } else {
    warn('Service was not loaded (may already be stopped)');
  }

  step('Removing plist file...');
  try {
    await fs.unlink(plistPath);
    success(`Removed: ${chalk.gray(plistPath)}`);
  } catch {
    warn('Plist file not found (may already be removed)');
  }

  console.log(chalk.green.bold('\n✅ Daemon uninstalled.\n'));
}

// --- Linux: systemd ---

function getLinuxServiceDir() {
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function getLinuxServicePath() {
  return path.join(getLinuxServiceDir(), `${SERVICE_LABEL}.service`);
}

function getLinuxLogDir() {
  return path.join(os.homedir(), '.local', 'share', 'knobase', 'logs');
}

function buildSystemdUnit(logDir) {
  return `[Unit]
Description=Knobase Webhook Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_PATH} ${WEBHOOK_SCRIPT} start
WorkingDirectory=${SKILL_DIR}
Restart=on-failure
RestartSec=10
StandardOutput=append:${path.join(logDir, 'daemon.log')}
StandardError=append:${path.join(logDir, 'daemon-error.log')}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

async function installLinux() {
  console.log(chalk.blue.bold('\n🐧 Installing Knobase daemon (systemd user service)\n'));

  const serviceDir = getLinuxServiceDir();
  const servicePath = getLinuxServicePath();
  const logDir = getLinuxLogDir();

  step('Creating log directory...');
  ensureDir(logDir);
  success(`Log directory: ${chalk.gray(logDir)}`);

  step('Creating systemd user service directory...');
  ensureDir(serviceDir);
  success(`Service directory: ${chalk.gray(serviceDir)}`);

  step('Writing systemd service unit...');
  const unitContent = buildSystemdUnit(logDir);
  await fs.writeFile(servicePath, unitContent, 'utf8');
  success(`Service file: ${chalk.gray(servicePath)}`);

  step('Setting file permissions...');
  await fs.chmod(servicePath, 0o644);
  success('Permissions set (644)');

  step('Reloading systemd daemon...');
  const reloadResult = run('systemctl --user daemon-reload');
  if (reloadResult !== null) {
    success('Daemon reloaded');
  } else {
    fail('Failed to reload systemd — is systemd available?');
    console.log(chalk.gray('    systemctl --user daemon-reload'));
  }

  step('Enabling service (auto-start on boot)...');
  const enableResult = run(`systemctl --user enable ${SERVICE_LABEL}`);
  if (enableResult !== null) {
    success('Service enabled');
  } else {
    fail('Failed to enable service — try manually:');
    console.log(chalk.gray(`    systemctl --user enable ${SERVICE_LABEL}`));
  }

  step('Starting service...');
  const startResult = run(`systemctl --user start ${SERVICE_LABEL}`);
  if (startResult !== null) {
    success('Service started');
  } else {
    fail('Failed to start service — try manually:');
    console.log(chalk.gray(`    systemctl --user start ${SERVICE_LABEL}`));
  }

  // Lingering allows user services to run without an active session
  step('Enabling lingering (services persist after logout)...');
  const lingerResult = run('loginctl enable-linger');
  if (lingerResult !== null) {
    success('Lingering enabled');
  } else {
    warn('Could not enable lingering — service may stop on logout');
    console.log(chalk.gray('    sudo loginctl enable-linger $USER'));
  }

  console.log(chalk.green.bold('\n✅ Daemon installed successfully!\n'));
  console.log(chalk.white('  The webhook server will now auto-start on boot.'));
  console.log(chalk.gray(`  Logs:    ${path.join(logDir, 'daemon.log')}`));
  console.log(chalk.gray(`  Errors:  ${path.join(logDir, 'daemon-error.log')}`));
  console.log(chalk.gray(`  Service: ${servicePath}\n`));
  console.log(chalk.white('Useful commands:'));
  console.log(chalk.gray(`  systemctl --user status ${SERVICE_LABEL}    # check status`));
  console.log(chalk.gray(`  systemctl --user stop ${SERVICE_LABEL}      # stop`));
  console.log(chalk.gray(`  systemctl --user start ${SERVICE_LABEL}     # start`));
  console.log(chalk.gray(`  systemctl --user restart ${SERVICE_LABEL}   # restart`));
  console.log(chalk.gray(`  journalctl --user -u ${SERVICE_LABEL} -f    # tail logs`));
  console.log('');
}

async function uninstallLinux() {
  console.log(chalk.blue.bold('\n🐧 Uninstalling Knobase daemon (systemd user service)\n'));

  const servicePath = getLinuxServicePath();

  step('Stopping service...');
  run(`systemctl --user stop ${SERVICE_LABEL}`);
  success('Service stopped');

  step('Disabling service...');
  run(`systemctl --user disable ${SERVICE_LABEL}`);
  success('Service disabled');

  step('Removing service file...');
  try {
    await fs.unlink(servicePath);
    success(`Removed: ${chalk.gray(servicePath)}`);
  } catch {
    warn('Service file not found (may already be removed)');
  }

  step('Reloading systemd daemon...');
  run('systemctl --user daemon-reload');
  success('Daemon reloaded');

  console.log(chalk.green.bold('\n✅ Daemon uninstalled.\n'));
}

// --- Windows ---

function getWindowsLogDir() {
  return path.join(os.homedir(), 'AppData', 'Local', 'Knobase', 'logs');
}

async function installWindows() {
  console.log(chalk.blue.bold('\n🪟 Installing Knobase daemon (Windows scheduled task)\n'));

  const logDir = getWindowsLogDir();

  step('Creating log directory...');
  ensureDir(logDir);
  success(`Log directory: ${chalk.gray(logDir)}`);

  const taskName = 'KnobaseDaemon';
  const logFile = path.join(logDir, 'daemon.log');

  step('Creating scheduled task...');
  const cmd = [
    'schtasks', '/Create',
    '/TN', `"${taskName}"`,
    '/TR', `"\\"${NODE_PATH}\\" \\"${WEBHOOK_SCRIPT}\\" start > \\"${logFile}\\" 2>&1"`,
    '/SC', 'ONLOGON',
    '/RL', 'LIMITED',
    '/F',
  ].join(' ');

  const result = run(cmd);
  if (result !== null) {
    success('Scheduled task created');
  } else {
    fail('Failed to create scheduled task');
    console.log(chalk.gray('  You may need to run this command as Administrator.\n'));
    console.log(chalk.white('  Alternative: use npm-windows-service'));
    console.log(chalk.gray('    npm install -g node-windows'));
    console.log(chalk.gray('    Then create a service wrapper script.\n'));
    return;
  }

  step('Starting task...');
  const runResult = run(`schtasks /Run /TN "${taskName}"`);
  if (runResult !== null) {
    success('Task started');
  } else {
    warn('Could not start task immediately — it will start on next login');
  }

  console.log(chalk.green.bold('\n✅ Daemon installed successfully!\n'));
  console.log(chalk.white('  The webhook server will auto-start on login.'));
  console.log(chalk.gray(`  Logs: ${logFile}\n`));
  console.log(chalk.white('Useful commands:'));
  console.log(chalk.gray(`  schtasks /Query /TN "${taskName}"     # check status`));
  console.log(chalk.gray(`  schtasks /End /TN "${taskName}"       # stop`));
  console.log(chalk.gray(`  schtasks /Run /TN "${taskName}"       # start`));
  console.log(chalk.gray(`  schtasks /Delete /TN "${taskName}" /F # remove`));
  console.log('');

  console.log(chalk.white('For a more robust Windows service, consider:'));
  console.log(chalk.gray('  npm install -g node-windows'));
  console.log(chalk.gray('  See: https://github.com/coreybutler/node-windows\n'));
}

async function uninstallWindows() {
  console.log(chalk.blue.bold('\n🪟 Uninstalling Knobase daemon (Windows scheduled task)\n'));

  const taskName = 'KnobaseDaemon';

  step('Stopping task...');
  run(`schtasks /End /TN "${taskName}"`);
  success('Task stopped');

  step('Deleting scheduled task...');
  const result = run(`schtasks /Delete /TN "${taskName}" /F`);
  if (result !== null) {
    success('Task deleted');
  } else {
    warn('Task not found (may already be removed)');
  }

  console.log(chalk.green.bold('\n✅ Daemon uninstalled.\n'));
}

// --- Main ---

async function main() {
  const platform = detectPlatform();

  console.log(chalk.blue.bold('\nKnobase Daemon Installer'));
  console.log(chalk.gray(`  Platform:  ${platform}`));
  console.log(chalk.gray(`  Node:      ${NODE_PATH}`));
  console.log(chalk.gray(`  Webhook:   ${WEBHOOK_SCRIPT}`));
  console.log(chalk.gray(`  Skill dir: ${SKILL_DIR}`));

  if (isUninstall) {
    switch (platform) {
      case 'macos':   return uninstallMac();
      case 'linux':   return uninstallLinux();
      case 'windows': return uninstallWindows();
      default:
        fail(`Unsupported platform: ${platform}`);
        process.exit(1);
    }
  } else {
    switch (platform) {
      case 'macos':   return installMac();
      case 'linux':   return installLinux();
      case 'windows': return installWindows();
      default:
        fail(`Unsupported platform: ${platform}`);
        console.log(chalk.gray('  Supported platforms: macOS, Linux, Windows'));
        process.exit(1);
    }
  }
}

main().catch(err => {
  console.error(chalk.red(`\nError: ${err.message}`));
  process.exit(1);
});
