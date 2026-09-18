' Launches run-refresh-task.cmd with a fully hidden window (mode 0) so the
' scheduled catalog refresh never creates a visible console window or steals
' foreground focus -- unlike `powershell -WindowStyle Hidden` alone, which
' can still briefly flash a window on some Windows builds, WScript.Run's
' window style 0 suppresses it at the Win32 level from the start.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdPath = scriptDir & "\run-refresh-task.cmd"

Set shell = CreateObject("WScript.Shell")
shell.Run """" & cmdPath & """", 0, True
