# Runs scrape-catalog.js, records the scrape into the price history
# (record-history.js), runs scrape-cf-vanguard.js, rebuilds
# pipeline/data/cards.json, and uploads it -- plus the price history and
# its served derivatives (history-public.json, movers.json) -- to the
# private Supabase Storage bucket the frontend reads from (via api/cards.js,
# api/history.js, api/movers.js). No git commit/push or Vercel redeploy
# needed for a data-only refresh; the site picks up the new data the next
# time a visitor's client cache expires. This keeps prices/stock, price
# history and official EN names/skill text current; it does NOT run
# scrape-card-detail.js (per-card JP skill text for cards with no EN
# release), which is a separate, much slower, manual step -- see
# run-detail-when-unblocked.sh.
#
# Step order matters:
#  1. scrape-catalog.js  -> data/catalog-raw.json
#  2. record-history.js  -> data/price-history.json (+ history-public.json,
#     movers.json, and a dated copy in data/history-backups/). Runs right
#     after the catalog scrape because it holds the gates: an empty catalog,
#     one >2% smaller than the largest of the last 7 days' runs (a partial
#     scrape -- yuyu-tei pages that failed 3 times are skipped, ~2% each),
#     or one whose content looks misread (<90% parseable prices, or >25% of
#     tracked listings changed at once) exits 1, which aborts the run here,
#     before the ~10-minute cf-vanguard scrape and before anything is
#     recorded or uploaded. It also needs .env: if the local history file is
#     missing it restores it from the bucket, and it refuses to start a
#     fresh one otherwise (see its header; ALLOW_CATALOG_SHRINK=1,
#     ALLOW_MASS_CHANGE=1 and HISTORY_INIT=1 are the manual overrides).
#  3. scrape-cf-vanguard.js -> data/cf-vanguard-raw.json -- but only if the
#     scrape is complete and not >2% smaller than the last one; otherwise it
#     keeps the previous file and exits 0, so the run carries on with the
#     last good official names (reference-gate.js)
#  4. build-data.js      -> data/cards.json (applies the same size gate
#     against the cards.json it would replace, refuses to drop >2% of the
#     listings that had an official English name, and adds each listing's
#     chg7d from the history step 2 just updated)
#  5. upload-cards.js    -> uploads price-history.json (private backup),
#     history-public.json, movers.json, then cards.json -- or nothing at
#     all if the local history is <90% the size of the bucket's copy (the
#     history only grows; FORCE_HISTORY_UPLOAD=1 overrides)
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
# and upload cards.json (and race on price-history.json, the one file here
# that can't be regenerated), so this guards against that rather than relying on
# timing alone. A lock older than 25 min is assumed to be from a
# crashed run (this script always removes its own lock, success or failure)
# and is taken over rather than left to block every future run forever.
$staleLockMinutes = 25
# refresh.log grows ~1 MB a week at 48 runs/day; past this size it's moved
# to refresh.old.log (replacing the previous one), so at most ~2x this is
# kept. Both names match .gitignore's *.log.
$maxLogBytes = 5MB
$oldLogFile = Join-Path $pipelineDir 'refresh.old.log'

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

# Rotated only once the lock is ours, so a run that's about to be skipped
# can't move the log out from under one that's still writing to it. A
# failed rotation (the log open in an editor) just waits for the next run.
try {
    if ([System.IO.File]::Exists($logFile) -and (New-Object System.IO.FileInfo $logFile).Length -gt $maxLogBytes) {
        if ([System.IO.File]::Exists($oldLogFile)) { [System.IO.File]::Delete($oldLogFile) }
        [System.IO.File]::Move($logFile, $oldLogFile)
    }
} catch {
    Log "Couldn't rotate refresh.log ($($_.Exception.Message)); continuing."
}

try {
    Set-Location -LiteralPath $pipelineDir

    Invoke-Native 'Starting refresh: scrape-catalog.js' 'node' @('scrape-catalog.js') | Out-Null
    Invoke-Native 'Recording price history: record-history.js' 'node' @('--env-file=.env', 'record-history.js') | Out-Null
    Invoke-Native 'Starting refresh: scrape-cf-vanguard.js' 'node' @('scrape-cf-vanguard.js') | Out-Null
    Invoke-Native 'Building pipeline/data/cards.json' 'node' @('build-data.js') | Out-Null
    Invoke-Native 'Uploading price history, movers and cards.json to Supabase Storage' 'node' @('--env-file=.env', 'upload-cards.js') | Out-Null

    Log 'Refresh complete.'
} catch {
    Log "ERROR: $_"
    exit 1
} finally {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
