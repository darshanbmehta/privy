// supervisor.js
// Launches 100 nodemon SSRN downloader instances in batches of 5, staggered by 5s, and refreshes each batch every 2 hours

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ES module __dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Accept number of instances as a command-line argument
const TOTAL = parseInt(process.argv[2], 10) || 100;

const BATCH_SIZE = 3;
const BATCH_DELAY = 5000; // 5 seconds between batches
const REFRESH_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in ms
// const REFRESH_INTERVAL = 60000; // 2 hours in ms
const SCRIPT = 'ultimate-ssrn-downloader-multi.js';
const WORKDIR = path.resolve(__dirname);

let processes = [];

// Cleanup downloads directory
function cleanupDownloads() {
  const downloadsDir = path.join(WORKDIR, 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    console.log('Downloads directory does not exist:', downloadsDir);
    return;
  }
  const files = fs.readdirSync(downloadsDir);
  if (files.length === 0) {
    console.log('No files to delete in downloads directory.');
    return;
  }
  for (const file of files) {
    const filePath = path.join(downloadsDir, file);
    try {
      fs.unlinkSync(filePath);
      console.log('Deleted:', filePath);
    } catch (err) {
      console.error('Failed to delete:', filePath, err.message);
    }
  }
  console.log('✅ Downloads directory cleaned up.');
}

function startBatch(batchNum) {
  const procs = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    const idx = batchNum * BATCH_SIZE + i + 1;
    if (idx > TOTAL) break;
    const proc = spawn('npx', ['nodemon', SCRIPT], {
      cwd: WORKDIR,
      stdio: 'inherit',
      env: { ...process.env, INSTANCE_ID: idx }
    });
    procs.push(proc);
    console.log(`[supervisor] Started instance ${idx} (batch ${batchNum + 1})`);
  }
  return procs;
}

function killBatch(batchProcs) {
  for (const proc of batchProcs) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  }
  // Also kill any orphaned Chromium processes (macOS)
  try {
    const result = spawnSync('pkill', ['-f', 'Chromium.app/Contents/MacOS/Chromium']);
    if (result.status === 0) {
      console.log('[supervisor] Orphaned Chromium processes killed.');
    } else if (result.status !== 1) { // 1 means no process found, which is fine
      console.error('[supervisor] Error killing Chromium processes:', result.stderr?.toString() || result.status);
    }
  } catch (err) {
    console.error('[supervisor] Failed to kill Chromium processes:', err.message);
  }
}

// Ensure all Chromium processes are killed on supervisor exit
function killAllChromium() {
  try {
    const result = spawnSync('pkill', ['-f', 'Chromium.app/Contents/MacOS/Chromium']);
    if (result.status === 0) {
      console.log('[supervisor] Orphaned Chromium processes killed on exit.');
    }
  } catch (err) {
    console.error('[supervisor] Failed to kill Chromium processes on exit:', err.message);
  }
}

process.on('SIGINT', () => {
  console.log('\n[supervisor] Caught SIGINT, cleaning up...');
  for (const batch of processes) {
    killBatch(batch);
  }
  killAllChromium();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[supervisor] Caught SIGTERM, cleaning up...');
  for (const batch of processes) {
    killBatch(batch);
  }
  killAllChromium();
  process.exit(0);
});

async function main() {
  const batchCount = Math.ceil(TOTAL / BATCH_SIZE);

  // Start all batches with staggered delay
  for (let b = 0; b < batchCount; b++) {
    processes[b] = startBatch(b);
    await new Promise(res => setTimeout(res, BATCH_DELAY));
  }

  // Periodically refresh each batch in order
  setInterval(async () => {
    console.log('[supervisor] Refreshing all batches...');
    for (let b = 0; b < batchCount; b++) {
      console.log(`[supervisor] Refreshing batch ${b + 1}`);
      killBatch(processes[b]);
      await new Promise(res => setTimeout(res, 1000)); // Small delay to ensure kill
      processes[b] = startBatch(b);
      await new Promise(res => setTimeout(res, BATCH_DELAY));
    }
  }, REFRESH_INTERVAL);

  // Periodically clean up downloads directory every 30 minutes
  setInterval(() => {
    console.log('[supervisor] Running downloads cleanup...');
    cleanupDownloads();
  }, 30 * 60 * 1000);
}

main();
