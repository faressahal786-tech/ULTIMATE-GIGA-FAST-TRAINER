param(
  [int]$Rounds = 0,
  [string]$Model = "opencode/muse-spark-1.3-contributor-free",
  [string]$Variant = "xhigh",
  [int]$MaxRateRetries = 5,
  [int]$RateWaitSecs = 60
)
# AUTO-LOOP: selfloop.py prompts opencode, opencode works, loop prompts again.
# Usage: .\autoloop.ps1 -Rounds 3
#        .\autoloop.ps1 -Rounds 0   # infinite until backlog empty (Ctrl+C or STOPLOOP file stops it)
# Rate limits: detected per round, retried with doubling backoff, loop stops after MaxRateRetries.
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
  $runArgs = @("run", "--dir", $root, "--auto", "-m", $Model, "--variant", $Variant, $prompt)
  $attempt = 0
  $wait = $RateWaitSecs
  $failed = $false
  while ($true) {
    Write-Output "round $round: starting opencode at $(Get-Date -Format HH:mm:ss)"
    $roundOut = @()
    & opencode @runArgs 2>&1 | Tee-Object -Variable roundOut
    $code = $LASTEXITCODE
    $text = $roundOut | Out-String
    Write-Output "round $round: opencode exited with code $code"
    $limited = ($code -ne 0) -and ($text -match "(?i)429|rate.?limit|quota|too many requests|overloaded|try again|retry-after|capacity")
    if ($limited -and $attempt -lt $MaxRateRetries) {
      $attempt++
      Write-Output "RATE LIMITED (retry $attempt/$MaxRateRetries) - waiting $wait s, then retrying round $round"
      Start-Sleep -Seconds $wait
      $wait = $wait * 2
    } elseif ($limited) {
      Write-Output "still rate limited after $MaxRateRetries retries - stopping loop"
      $failed = $true
      break
    } elseif ($code -ne 0) {
      Write-Output "opencode exited $code - stopping loop"
      $failed = $true
      break
    } else {
      break
    }
  }
  if ($failed) { break }
  if (Test-Path (Join-Path $root "STOPLOOP")) { Write-Output "STOPLOOP file found - stopping"; break }
}
Write-Output "auto-loop finished after $round round(s)."
