# Exercises the lock decision in ../refresh-lock.ps1 (no real lock file, no
# kills). Exits 1 on any failure. test/refresh-lock.test.js runs this under
# `npm test` (Windows PowerShell 5.1 only; skipped elsewhere). By hand, from
# the pipeline directory (PIPELINE_DIR tells it where refresh-lock.ps1 is):
#   $env:PIPELINE_DIR = (Get-Location).ProviderPath
#   powershell -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText('test\refresh-lock.test.ps1')))"
$ErrorActionPreference = 'Stop'
# Read + dot-source as a scriptblock: a plain `. path` (and `-File path`) choke
# on "[Main-Main]" in the repo path, so this test is run from the pipeline
# directory with the file's contents passed as a scriptblock (see
# refresh-lock.test.js), which also means $PSScriptRoot is empty here.
. ([scriptblock]::Create([System.IO.File]::ReadAllText((Join-Path $env:PIPELINE_DIR 'refresh-lock.ps1'))))

$script:failures = 0
function Check($name, $actual, $expected) {
    if ($actual -eq $expected) { Write-Host "ok   $name" }
    else { Write-Host "FAIL $name (got '$actual', want '$expected')"; $script:failures++ }
}

$stale = 25
$max = 180
$ft = 133000000000000000
$formatted = [System.DateTime]::FromFileTimeUtc($ft).ToString('yyyy-MM-ddTHH:mm:ss')
$alive = { param($p) New-Object psobject -Property @{ State = 'alive'; FileTime = 133000000000000000 } }
$gone = { param($p) New-Object psobject -Property @{ State = 'gone'; FileTime = $null } }
$unknown = { param($p) New-Object psobject -Property @{ State = 'unknown'; FileTime = $null } }
$reused = { param($p) New-Object psobject -Property @{ State = 'alive'; FileTime = 133000000000000001 } }

function Decide($text, $age, $lookup) { (Get-LockDecision $text $age $stale $max $lookup).Action }

Check 'no lock' (Decide $null 0 $gone) 'run'
Check 'old format, fresh' (Decide '2026-10-07T10:00:00.0000000+07:00' 10 $gone) 'skip'
Check 'old format, stale' (Decide '2026-10-07T10:00:00.0000000+07:00' 30 $alive) 'takeover'
Check 'live owner, young' (Decide "pid=100 start=$ft time=x" 5 $alive) 'skip'
Check 'live owner, 2 h (below ceiling)' (Decide "pid=100 start=$ft time=x" 120 $alive) 'skip'
Check 'live owner, 25+ min but not hung' (Decide "pid=100 start=$ft time=x" 40 $alive) 'skip'
Check 'dead PID' (Decide "pid=100 start=$ft time=x" 5 $gone) 'takeover'
Check 'reused PID (different start time)' (Decide "pid=100 start=$ft time=x" 5 $reused) 'takeover'
Check 'unreadable start time, young' (Decide "pid=100 start=$ft time=x" 5 $unknown) 'skip'
Check 'unreadable start time, 1 day (never killed)' (Decide "pid=100 start=$ft time=x" 1440 $unknown) 'takeover'
Check 'live owner over the ceiling' (Decide "pid=100 start=$ft time=x" 181 $alive) 'kill-takeover'
Check 'live owner at the ceiling' (Decide "pid=100 start=$ft time=x" 180 $alive) 'kill-takeover'
Check 'ceiling names the owner pid' ((Get-LockDecision "pid=100 start=$ft time=x" 200 $stale $max $alive).OwnerPid) 100
Check 'reused PID over the ceiling is not killed' (Decide "pid=100 start=$ft time=x" 500 $reused) 'takeover'
Check 'legacy formatted start, same process' (Decide "pid=100 start=$formatted time=x" 5 $alive) 'skip'
$reusedLater = { param($p) New-Object psobject -Property @{ State = 'alive'; FileTime = 133000000100000000 } }   # 10 s later
Check 'legacy formatted start, reused PID' (Decide "pid=100 start=$formatted time=x" 5 $reusedLater) 'takeover'
Check 'lock written by an owner that could not read its start (0), young' (Decide 'pid=100 start=0 time=x' 5 $alive) 'skip'
Check 'lock with start=0 over the ceiling is not killed' (Decide 'pid=100 start=0 time=x' 500 $alive) 'takeover'
Check 'garbage lock text falls back to age (fresh)' (Decide 'garbage' 3 $alive) 'skip'

# The real lookup: this process is alive with a readable start, an absurd PID is gone.
$self = Get-ProcessState $PID
Check 'real: own process is alive' $self.State 'alive'
Check 'real: own start time matches itself' (Test-LockStartMatches "$($self.FileTime)" $self.FileTime) $true
Check 'real: no such PID is gone' (Get-ProcessState 2147480000).State 'gone'
# PID 4 (System) exists; from a normal shell its start time is unreadable. It
# must never come back as gone, whichever way this machine answers.
Check 'real: System process is not reported gone' ((Get-ProcessState 4).State -ne 'gone') $true

if ($script:failures -gt 0) { Write-Host "$($script:failures) failure(s)"; exit 1 }
Write-Host 'all passed'
