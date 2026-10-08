#Requires -Version 5.1
# DEC-0002 — worktree spawn/resume helpers (S-orch; dot-sourced by orchestrate.ps1)

function Invoke-GitCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$GitArgs
  )
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git @GitArgs 2>&1
    $exit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  return [PSCustomObject]@{
    Output   = $output
    ExitCode = $exit
  }
}

function Get-GitCommonDir([string]$StartPath) {
  Push-Location $StartPath
  try {
    $r = Invoke-GitCommand -GitArgs @("rev-parse", "--git-common-dir")
    if ($r.ExitCode -ne 0 -or -not $r.Output) { return $null }
    $common = ($r.Output | ForEach-Object { "$_" }).Trim()
    if (-not $common) { return $null }
    return (Resolve-Path $common).Path
  } finally {
    Pop-Location
  }
}

function Get-WorktreeBranch([string]$WtPath) {
  Push-Location $WtPath
  try {
    $r = Invoke-GitCommand -GitArgs @("branch", "--show-current")
    if ($r.ExitCode -ne 0 -or -not $r.Output) { return $null }
    $b = ($r.Output | ForEach-Object { "$_" }).Trim()
    if (-not $b) { return $null }
    return $b
  } finally {
    Pop-Location
  }
}

function Test-PathRegisteredWorktree([string]$Root, [string]$WtPath) {
  Push-Location $Root
  try {
    $r = Invoke-GitCommand -GitArgs @("worktree", "list", "--porcelain")
    if ($r.ExitCode -ne 0) { return $false }
    $lines = @($r.Output | ForEach-Object { "$_" })
    if (@($lines).Count -eq 0) { return $false }
    $resolvedWt = (Resolve-Path $WtPath).Path
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match "^worktree\s+(.+)$") {
        $listed = (Resolve-Path $Matches[1]).Path
        if ($listed -eq $resolvedWt) { return $true }
      }
    }
    return $false
  } finally {
    Pop-Location
  }
}

function Assert-WorktreeMatchesTask([string]$Root, [string]$WtPath, [string]$ExpectedBranch) {
  if (-not (Test-Path $WtPath)) { return }
  $rootCommon = Get-GitCommonDir $Root
  $wtCommon = Get-GitCommonDir $WtPath
  if (-not $rootCommon -or -not $wtCommon -or $rootCommon -ne $wtCommon) {
    throw "Worktree path exists but is not part of this repository: $WtPath"
  }
  if (-not (Test-PathRegisteredWorktree $Root $WtPath)) {
    throw "Path exists but is not a registered git worktree for this repo: $WtPath"
  }
  $branch = Get-WorktreeBranch $WtPath
  if ($branch -ne $ExpectedBranch) {
    throw "Worktree $WtPath is on branch '$branch' (expected '$ExpectedBranch')"
  }
}

function Write-SpawnArtifacts(
  [string]$Wt,
  [string]$Prompt,
  [string]$HandoffText
) {
  $promptPath = Join-Path $Wt "PROMPT.md"
  $handoffPath = Join-Path $Wt "HANDOFF.md"
  Set-Content -Path $promptPath -Value $Prompt -Encoding UTF8
  if (-not (Test-Path $handoffPath)) {
    Set-Content -Path $handoffPath -Value $HandoffText -Encoding UTF8
  }
}

function Invoke-GitWorktreeAdd([string]$Root, [string]$Branch, [string]$WtPath) {
  Push-Location $Root
  try {
    $r = Invoke-GitCommand -GitArgs @("worktree", "add", "-b", $Branch, $WtPath, "HEAD")
    if ($r.ExitCode -ne 0) { throw "git worktree add failed" }
  } finally {
    Pop-Location
  }
}
