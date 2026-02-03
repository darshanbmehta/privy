// cleanup-downloads.js
// Deletes all files in /Users/darshanbmehta/eb1/downloads/

import fs from 'fs';
import path from 'path';

const downloadsDir = '/Users/darshanbmehta/eb1/downloads';

if (!fs.existsSync(downloadsDir)) {
  console.log('Downloads directory does not exist:', downloadsDir);
  process.exit(0);
}

const files = fs.readdirSync(downloadsDir);
if (files.length === 0) {
  console.log('No files to delete in downloads directory.');
  process.exit(0);
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
