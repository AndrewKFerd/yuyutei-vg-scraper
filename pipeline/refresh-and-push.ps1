# Runs scrape-catalog.js, records the scrape into the price history
# (record-history.js), runs scrape-cf-vanguard.js, rebuilds
# pipeline/data/cards.json, and uploads it -- plus the price history and
# its served derivatives (history-public.json, movers.json) -- to the
# private Supabase Storage bucket the frontend reads from (via api/catalog.js,
# api/details/[set].js, api/history.js, api/movers.js). No git commit/push or Vercel redeploy
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
#  3. scrape-cf-vanguard.js -> data/cf-vanguard-raw.json -- at most about
#     once a day: skipped when the file was written < 20 h ago (official
#     names change weekly at most, and the scrape is ~9 of a run's ~12 min).
#     FORCE_CF_VANGUARD=1 forces it. When it does run, the file is only
#     replaced if the scrape is complete and not >2% smaller than the last
#     one; otherwise it keeps the previous file (and so its old mtime, which
#     makes the next run retry) and exits 0, so the run carries on with the
#     last good official names (reference-gate.js)
#  4. build-data.js      -> data/cards.json, plus the slim catalog.json and
#     details/<set>.json shards the frontend loads (applies the same size
#     gate against the cards.json it would replace, refuses to drop >2% of
#     the listings that had an official English name, and adds each
#     listing's chg7d from the history step 2 just updated)
#  5. upload-cards.js    -> uploads price-history.json (private backup),
#     history-public.json, movers.json, the detail shards whose content
#     changed, then catalog.json and cards.json -- or nothing at
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
# timing alone. A lock whose owning process is gone is assumed to be from a
# crashed run (this script always removes its own lock, success or failure)
# and is taken over rather than left to block every future run forever; see
# the lock handling below for how an owner that is still alive is detected.
# Only a lock in the old timestamp-only format is judged by age, using this
# many minutes.
$staleLockMinutes = 25
# A run that is still alive after this long is presumed hung (a normal run is
# ~12 min; even the first cf-vanguard scrape of a day is ~25).
$maxLockMinutes = 180
# refresh.log grows ~1 MB a week at 48 runs/day; past this size it's moved
# to refresh.old.log (replacing the previous one), so at most ~2x this is
# kept. Both names match .gitignore's *.log.
$maxLogBytes = 5MB
# cf-vanguard-raw.json older than this is re-scraped (see the step below).
# 20 h rather than 24 so the scrape lands around the same time each day
# despite run-to-run jitter, instead of drifting later and later.
$cfVanguardMaxAgeHours = 20
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

# The lock records who holds it ("pid=<n> start=<process start as a FILETIME>
# time=<when written>"); refresh-lock.ps1 holds the decision logic and its
# header explains the formats. In short:
#  - owner alive (same PID AND same start time): skip, however old the lock.
#    A run that slept mid-scrape and woke up is alive and will carry on, and
#    taking its lock would put two runs on price-history.json.
#  - owner gone (no such PID, or the PID was reused by another process):
#    take over.
#  - owner exists but its start time can't be read (an elevated or protected
#    process seen from a normal shell): decided by its process NAME, which is
#    readable across elevation. Not powershell/pwsh: some other process that
#    inherited a dead run's PID, so the owner is gone, take over. powershell/
#    pwsh (or a name that can't be read either): possibly the owner at another
#    elevation, so never taken over and never killed, however old -- the run
#    skips with a loud warning once past the ceiling.
#  - ceiling, so a hung run can't block every future run forever: an owner
#    that is verifiably still the lock's owner (same PID and start time) after
#    $maxLockMinutes is presumed hung; it and its child processes are killed
#    (taskkill /T /F), and only if it is then gone is the lock taken over.
#  - old timestamp-only lock: no owner to ask, so the $staleLockMinutes age
#    rule applies.
# Backstop outside this script: set the Task Scheduler task to "If the task is
# already running: Do not start a new instance" and "Stop the task if it runs
# longer than 2 hours" (see README).
# (Dot-sourcing a path containing "[Main-Main]" fails on the wildcard parse,
# so the file is read with .NET IO and dot-sourced as a scriptblock.)
. ([scriptblock]::Create([System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'refresh-lock.ps1'))))

$lockText = $null
$ageMinutes = 0
if (Test-Path -LiteralPath $lockFile) {
    $ageMinutes = ((Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime).TotalMinutes
    $lockText = ''
    try { $lockText = [System.IO.File]::ReadAllText($lockFile) } catch { }
}
$decision = Get-LockDecision $lockText $ageMinutes $staleLockMinutes $maxLockMinutes $null
if ($decision.Message) { Log $decision.Message }
if ($decision.Action -eq 'skip') { exit 0 }
if ($decision.Action -eq 'kill-takeover') {
    # Same treatment as Invoke-Native: taskkill writes ordinary messages (or a
    # "process not found" for a child that already exited) to stderr, which
    # under 'Stop' + 2>&1 would be a terminating error before the lock is ours.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $killOutput = & taskkill.exe /PID $decision.OwnerPid /T /F 2>&1 | Out-String
        $killExit = $LASTEXITCODE
    } catch {
        $killOutput = "$_"
        $killExit = -1
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    Log "taskkill (exit $killExit): $($killOutput.Trim())"
    Start-Sleep -Seconds 5
    # Never double-run: if the owner somehow survived, leave it to the next
    # run (or the Task Scheduler stop-after-2-h backstop).
    $afterKill = Get-ProcessState $decision.OwnerPid
    if ($afterKill.State -ne 'gone') {
        Log "ERROR: the hung run (pid $($decision.OwnerPid)) is still alive after taskkill. Not taking over the lock; skipping this run."
        exit 0
    }
}
$ownState = Get-ProcessState $PID
$ownStart = 0
if ($ownState.State -eq 'alive') { $ownStart = $ownState.FileTime }
[System.IO.File]::WriteAllText($lockFile, "pid=$PID start=$ownStart time=$((Get-Date).ToString('o'))")

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
    # The cf-vanguard scrape is ~316 requests and ~9 of a run's ~12 minutes,
    # for official English names that change at most weekly, so it runs at
    # most about once a day: skipped while cf-vanguard-raw.json is younger
    # than $cfVanguardMaxAgeHours. The file's mtime only advances when a
    # scrape is accepted (an incomplete/shrunken one keeps the previous file
    # and its old mtime, see reference-gate.js), so a failed scrape retries on
    # the very next run instead of waiting another day.
    $cfRaw = Join-Path $pipelineDir 'data\cf-vanguard-raw.json'
    $cfAgeHours = $null
    if ([System.IO.File]::Exists($cfRaw)) {
        $cfAgeHours = ((Get-Date) - [System.IO.File]::GetLastWriteTime($cfRaw)).TotalHours
    }
    if ($env:FORCE_CF_VANGUARD -eq '1') {
        Invoke-Native 'Starting refresh: scrape-cf-vanguard.js (forced by FORCE_CF_VANGUARD=1)' 'node' @('scrape-cf-vanguard.js') | Out-Null
    } elseif ($null -ne $cfAgeHours -and $cfAgeHours -lt $cfVanguardMaxAgeHours) {
        Log "Skipping scrape-cf-vanguard.js: cf-vanguard-raw.json is $([math]::Round($cfAgeHours, 1)) h old (re-scraped after $cfVanguardMaxAgeHours h; FORCE_CF_VANGUARD=1 forces it)."
    } else {
        Invoke-Native 'Starting refresh: scrape-cf-vanguard.js' 'node' @('scrape-cf-vanguard.js') | Out-Null
    }
    Invoke-Native 'Building pipeline/data/cards.json' 'node' @('build-data.js') | Out-Null
    Invoke-Native 'Uploading price history, movers and cards.json to Supabase Storage' 'node' @('--env-file=.env', 'upload-cards.js') | Out-Null

    Log 'Refresh complete.'
} catch {
    Log "ERROR: $_"
    exit 1
} finally {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
