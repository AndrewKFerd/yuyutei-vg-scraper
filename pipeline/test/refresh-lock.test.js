'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Runs test/refresh-lock.test.ps1, the exercise of refresh-lock.ps1's lock
// decision (live / dead / reused PID, unreadable start time, ceiling...).
// Needs Windows PowerShell 5.1, the engine the scheduled task uses.
const hasPowerShell = process.platform === 'win32' && spawnSync('powershell.exe', ['-NoProfile', '-Command', '1']).status === 0;

test('refresh-lock.ps1 lock decisions', { skip: !hasPowerShell && 'Windows PowerShell not available' }, () => {
  const pipelineDir = path.join(__dirname, '..');
  const cmd = "& ([scriptblock]::Create([System.IO.File]::ReadAllText('test\\refresh-lock.test.ps1')))";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
    cwd: pipelineDir,
    env: { ...process.env, PIPELINE_DIR: pipelineDir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /all passed/);
});
