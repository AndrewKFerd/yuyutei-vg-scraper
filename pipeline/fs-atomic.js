'use strict';

/**
 * Crash-safe file writes, shared by every script that replaces a data file
 * the next run depends on (price-history.json, cards.json,
 * card-details-raw.json, cf-vanguard-raw.json, catalog-raw.json).
 */

const fs = require('fs');
const path = require('path');

// On Windows a rename onto a file that antivirus/indexing has momentarily
// open fails with EPERM/EBUSY; a short retry rides that out instead of
// failing the whole unattended run.
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

/**
 * Write, fsync, then rename, so a crash, power cut or full disk mid-write
 * leaves the previous file intact rather than a truncated one (which the
 * next run would refuse to load). The fsync matters because the rename can
 * otherwise reach the disk before the data does.
 */
function writeFileAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  renameWithRetry(tmp, filePath);
}

module.exports = { writeFileAtomic, renameWithRetry };
