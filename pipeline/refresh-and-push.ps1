# Runs scrape-catalog.js + scrape-cf-vanguard.js, rebuilds
# pipeline/data/cards.json, and uploads it to the private Supabase Storage
# bucket the frontend reads from (via api/cards.js) -- no git commit/push
# or Vercel redeploy needed for a data-only refresh; the site picks up the
# new data the next time a visitor's daily cache expires. This keeps
# prices/stock and official EN names/skill text current; it does NOT run
# scrape-card-detail.js (per-card JP skill text for cards with no EN
# release), which is a separate, much slower, manual step -- see
# run-detail-when-unblocked.sh.
#
# This replaced a GitHub Actions cron doing the same thing: yuyu-tei blocks
# GitHub's cloud runner IPs outright (a couple of clean requests, then a hard
# 403 on every request from page 3 on), so the catalog scrape can only run
# from a machine yuyu-tei hasn't flagged -- in practice, this one. Meant to
# be run on a recurring local schedule (Windows Task Scheduler), which is
# why it only requires this machine be on, not any cloud credentials.
#
# Two PowerShell gotchas this works around, both bitten during testing:
#
# 1. This repo's own path contains "[Main-Main]", which PowerShell's
#    filesystem-provider cmdlets (Add-Content, Tee-Object, Set-Location
#    -Path, -File on the command line, etc.) parse as a wildcard *character
#    class* and reject as invalid. Every path touch below uses -LiteralPath
#    or raw .NET IO (which takes the string as-is) to route around that.
#
# 2. With $ErrorActionPreference = 'Stop' (the default we still want for
#    catching real script bugs), redirecting a native command's stderr with
#    2>&1 turns EVERY stderr line into a terminating error -- and both
#    node scripts here write ordinary retry/progress warnings to stderr via
#    console.warn, success or not (git does the same with its progress/
#    remote messages). That turned merely-retrying-a-504 into a hard abort
#    during testing. Fix: run native commands under 'Continue' and decide
#    success/failure from $LASTEXITCODE ourselves, not from stderr content.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -Command
#          "Set-Location -LiteralPath '<repo>\pipeline'; .\refresh-and-push.ps1"

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pipelineDir = Join-Path $repoRoot 'pipeline'
$logFile = Join-Path $pipelineDir 'refresh.log'
$lockFile = Join-Path $pipelineDir 'refresh.lock'
# A full run takes ~11-12 min inside a 30-min schedule, so overlap should be
# rare -- but scrape-catalog.js/scrape-cf-vanguard.js can block for extended
# periods on rate-limit backoff, and two concurrent runs would both write
# and upload cards.json, so this guards against that rather than relying on
# timing alone. A lock older than 25 min is assumed to be from a
# crashed run (this script always removes its own lock, success or failure)
# and is taken over rather than left to block every future run forever.
$staleLockMinutes = 25

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    [System.IO.File]::AppendAllText($logFile, "$line`r`n")
}

# Runs a native command with stderr treated as ordinary output (see gotcha
# #2 above), logs its combined output, and throws iff its exit code was
# non-zero -- the only signal we actually trust.
function Invoke-Native($label, $exe, $exeArgs) {
    Log $label
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $exe @exeArgs 2>&1 | Out-String
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    Write-Host $output
    [System.IO.File]::AppendAllText($logFile, $output)
    if ($LASTEXITCODE -ne 0) { throw "$label exited $LASTEXITCODE" }
    return $output
}

if (Test-Path -LiteralPath $lockFile) {
    $ageMinutes = ((Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime).TotalMinutes
    if ($ageMinutes -lt $staleLockMinutes) {
        Log "Another refresh appears to be in progress (lock is $([int]$ageMinutes) min old). Skipping this run."
        exit 0
    }
    Log "Stale lock found ($([int]$ageMinutes) min old, a previous run likely crashed) -- taking over."
}
[System.IO.File]::WriteAllText($lockFile, (Get-Date).ToString('o'))

try {
    Set-Location -LiteralPath $pipelineDir

    Invoke-Native 'Starting refresh: scrape-catalog.js' 'node' @('scrape-catalog.js') | Out-Null
    Invoke-Native 'Starting refresh: scrape-cf-vanguard.js' 'node' @('scrape-cf-vanguard.js') | Out-Null
    Invoke-Native 'Building pipeline/data/cards.json' 'node' @('build-data.js') | Out-Null
    Invoke-Native 'Uploading cards.json to Supabase Storage' 'node' @('--env-file=.env', 'upload-cards.js') | Out-Null

    Log 'Refresh complete.'
} catch {
    Log "ERROR: $_"
    exit 1
} finally {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
