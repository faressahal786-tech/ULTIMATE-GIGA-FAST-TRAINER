param(
  [int]$Rounds = 0,
  [string]$Model = ""
)
# AUTO-LOOP: selfloop.py prompts opencode, opencode works, loop prompts again.
# Usage: .\autoloop.ps1 -Rounds 3
#        .\autoloop.ps1 -Rounds 0   # infinite until backlog empty (Ctrl+C or STOPLOOP file stops it)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $env:LOCALAPPDATA "Programs\PythonEmbed\python.exe"
$looper = Join-Path $root "chess-engine-trainer\selfloop.py"
$round = 0
while ($true) {
  if ($Rounds -gt 0 -and $round -ge $Rounds) { break }
  $prompt = & $python $looper next
  if ($prompt -match "LOOP COMPLETE") { Write-Output $prompt; break }
  $round++
  Write-Output "=== AUTO-LOOP ROUND $round ==="
  $runArgs = @("run", "--dir", $root, "--auto", $prompt)
  if ($Model -ne "") { $runArgs += @("-m", $Model) }
  & opencode @runArgs
  if ($LASTEXITCODE -ne 0) { Write-Output "opencode exited $LASTEXITCODE - stopping loop"; break }
  if (Test-Path (Join-Path $root "STOPLOOP")) { Write-Output "STOPLOOP file found - stopping"; break }
}
Write-Output "auto-loop finished after $round round(s)."
