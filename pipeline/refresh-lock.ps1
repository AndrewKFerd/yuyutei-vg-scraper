# Lock decision logic for refresh-and-push.ps1, kept in its own file so it can
# be dot-sourced and exercised on its own (see test/refresh-lock.test.ps1). Only
# defines functions; nothing runs on load. PowerShell 5.1 compatible, ASCII only.
#
# The lock file holds "pid=<n> start=<n> time=<iso>" where start is the owner
# process's StartTime as a Windows FILETIME (UTC, integer: no culture, no DST).
# The PID alone isn't enough -- Windows reuses them -- so the start time is
# compared too. Two older formats are still understood: start as a formatted
# UTC string (yyyy-MM-ddTHH:mm:ss), and a bare timestamp with no owner at all.

# Looks a process up. Returns an object with:
#   State     'gone'    no such PID (the only state that makes a lock stale)
#             'alive'   it exists and its start time was read
#             'unknown' it exists but its start time can't be read (an
#                       elevated or system process seen from a non-elevated
#                       shell) -- NOT the same as gone
#   FileTime  the start time as a FILETIME (alive only)
#   Name      the process name, when readable (also for 'unknown')
function Get-ProcessState($processId) {
    $p = $null
    try {
        $p = [System.Diagnostics.Process]::GetProcessById([int]$processId)
    } catch [System.ArgumentException] {
        # "Process with an Id of n is not running" -- the only way to be gone.
        return New-Object psobject -Property @{ State = 'gone'; FileTime = $null; Name = $null }
    } catch {
        return New-Object psobject -Property @{ State = 'unknown'; FileTime = $null; Name = $null }
    }
    # The name is readable even when the start time is not (across elevation).
    $name = $null
    try { $name = $p.ProcessName } catch { }
    try {
        $ft = $p.StartTime.ToFileTimeUtc()
        return New-Object psobject -Property @{ State = 'alive'; FileTime = $ft; Name = $name }
    } catch {
        return New-Object psobject -Property @{ State = 'unknown'; FileTime = $null; Name = $name }
    }
}

# Does the start value stored in the lock match the live process's start time?
# Returns $true / $false, or $null when the lock's value can't be compared.
function Test-LockStartMatches($lockStart, $fileTime) {
    if ($lockStart -match '^\d+$') {
        if ([int64]$lockStart -le 0) { return $null }   # owner couldn't read its own start time
        return ([int64]$lockStart -eq [int64]$fileTime)
    }
    if ($lockStart -match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$') {
        $formatted = [System.DateTime]::FromFileTimeUtc([int64]$fileTime).ToString('yyyy-MM-ddTHH:mm:ss')
        return ($lockStart -eq $formatted)
    }
    return $null
}

# Decides what a new run does about an existing lock.
#   $lockText     contents of refresh.lock, or $null when there is no lock
#   $ageMinutes   how long ago the lock was written
#   $staleMinutes age after which an OLD-format lock (no owner) is stale
#   $maxMinutes   ceiling: a live owner holding the lock longer than this is hung
#   $lookup       scriptblock PID -> Get-ProcessState result (injectable for tests)
# Returns an object: Action = run | skip | takeover | kill-takeover, plus
# Message (for the log) and OwnerPid.
function Get-LockDecision($lockText, $ageMinutes, $staleMinutes, $maxMinutes, $lookup) {
    if ($null -eq $lookup) { $lookup = { param($p) Get-ProcessState $p } }
    $age = [int]$ageMinutes
    if ($null -eq $lockText) {
        return New-Object psobject -Property @{ Action = 'run'; Message = $null; OwnerPid = $null }
    }
    if ($lockText -notmatch 'pid=(\d+) start=(\S+)') {
        # Old format: just a timestamp, no owner to ask.
        if ($ageMinutes -lt $staleMinutes) {
            return New-Object psobject -Property @{ Action = 'skip'; OwnerPid = $null; Message = "Another refresh appears to be in progress (old-format lock, $age min old). Skipping this run." }
        }
        return New-Object psobject -Property @{ Action = 'takeover'; OwnerPid = $null; Message = "Stale lock found ($age min old, old format, a previous run likely crashed) -- taking over." }
    }
    $ownerPid = [int]$Matches[1]
    $lockStart = $Matches[2]
    $state = & $lookup $ownerPid
    if ($state.State -eq 'gone') {
        return New-Object psobject -Property @{ Action = 'takeover'; OwnerPid = $ownerPid; Message = "Stale lock found (pid $ownerPid is no longer running, lock is $age min old) -- taking over." }
    }
    $same = $null
    if ($state.State -eq 'alive') { $same = Test-LockStartMatches $lockStart $state.FileTime }
    if ($same -eq $false) {
        return New-Object psobject -Property @{ Action = 'takeover'; OwnerPid = $ownerPid; Message = "Stale lock found (pid $ownerPid now belongs to a different process, so the run that wrote the lock is gone; lock is $age min old) -- taking over." }
    }
    if ($same -eq $true) {
        # Verified: the process that wrote the lock is still running.
        if ($age -ge $maxMinutes) {
            return New-Object psobject -Property @{ Action = 'kill-takeover'; OwnerPid = $ownerPid; Message = "WARNING: the refresh run holding the lock (pid $ownerPid) has been running $age min, over the $maxMinutes min ceiling, so it is presumed hung. Killing it and its child processes and taking over." }
        }
        return New-Object psobject -Property @{ Action = 'skip'; OwnerPid = $ownerPid; Message = "Another refresh is still running (pid $ownerPid, lock is $age min old). Skipping this run." }
    }
    # The PID exists but can't be matched to the lock's owner (its start time is
    # unreadable -- an elevated or protected process seen from a normal shell --
    # or the lock holds no usable start time). The process NAME is readable
    # across elevation and settles the common cases:
    #  - not powershell/pwsh: the refresh script runs in one of those, so this
    #    is some other process that inherited a dead run's PID: the owner is
    #    gone, take over now.
    #  - powershell/pwsh: it may well be the owner, at another elevation. It is
    #    never taken over and never killed, however old the lock: skip loudly.
    #    (The Task Scheduler "stop the task if it runs longer than 2 hours"
    #    setting is the backstop for a genuinely hung one.)
    #  - name unreadable too: can't rule the owner out, same as powershell.
    $name = if ($state.Name) { [string]$state.Name } else { $null }
    if ($name -and $name -notmatch '^(powershell|pwsh)(\.exe)?$') {
        return New-Object psobject -Property @{ Action = 'takeover'; OwnerPid = $ownerPid; Message = "Stale lock found (pid $ownerPid is '$name', not a PowerShell process, so it can't be the run that wrote the lock; lock is $age min old) -- taking over." }
    }
    $who = if ($name) { $name } else { 'a process whose name can not be read' }
    $loud = if ($age -ge $maxMinutes) { 'WARNING: ' } else { '' }
    return New-Object psobject -Property @{ Action = 'skip'; OwnerPid = $ownerPid; Message = "${loud}Another refresh may still be running: pid $ownerPid is $who and its start time can't be read, so it can't be told apart from the lock's owner; lock is $age min old. Not taking over or killing it; skipping this run. If it is really hung, the Task Scheduler stop-after-2-hours setting has to end it." }
}
