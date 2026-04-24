param(
  [string]$Message = "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  [string]$Branch = "",
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Invoke-CommandStep {
  param(
    [string]$Command,
    [string[]]$Arguments = @()
  )

  $display = ($Command + " " + ($Arguments -join " ")).Trim()

  if ($DryRun) {
    Write-Host "[dry-run] $display"
    return
  }

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $display"
  }
}

function Get-GitOutput {
  param(
    [string[]]$Arguments
  )

  $output = & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: git $($Arguments -join ' ')"
  }

  return ($output -join "`n").Trim()
}

$repoRoot = Get-GitOutput @("rev-parse", "--show-toplevel")
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = Get-GitOutput @("branch", "--show-current")
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
  throw "Could not determine the current Git branch. Pass -Branch explicitly."
}

$remoteUrl = Get-GitOutput @("remote", "get-url", "origin")
Write-Host "Repository: $repoRoot"
Write-Host "Remote: $remoteUrl"
Write-Host "Branch: $Branch"

if (-not $SkipBuild) {
  Invoke-CommandStep "npm" @("run", "build")
}

$changes = Get-GitOutput @("status", "--porcelain")

if (-not [string]::IsNullOrWhiteSpace($changes)) {
  Invoke-CommandStep "git" @("add", "-A")
  Invoke-CommandStep "git" @("commit", "-m", $Message)
}
else {
  Write-Host "No local changes to commit."
}

Invoke-CommandStep "git" @("push", "origin", $Branch)

if ($DryRun) {
  Write-Host "Dry run complete. No commit or push was performed."
}
else {
  Write-Host "Pushed to GitHub. GitHub Actions will handle the Azure Static Web Apps deployment."
}
