' Launches Gemma Course Tutor with no console window: starts the Bun server
' (which opens the Edge app window) from this script's own folder.
' The Start Menu shortcut created by scripts\install-shortcut.ps1 points here.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "bun run src/server.ts --open", 0, False
