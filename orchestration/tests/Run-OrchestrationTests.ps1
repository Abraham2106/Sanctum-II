#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$CheckoutRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Orchestrate = Join-Path $CheckoutRoot "orchestration\orchestrate.ps1"
$WorktreeHelpers = Join-Path $CheckoutRoot "orchestration\worktree-helpers.ps1"
$SourcePrompts = Join-Path $CheckoutRoot "orchestration\prompts"
$TestDirRoot = (Resolve-Path $PSScriptRoot).Path

$script:failures = @()

function Assert-True([bool]$cond, [string]$name) {
  if (-not $cond) { $script:failures += $name }
}

function Assert-Throws([scriptblock]$block, [string]$name) {
  try {
    & $block | Out-Null
    $script:failures += "$name (expected throw)"
  } catch {
    # ok
  }
}

function Invoke-NativeGit {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$GitArgs
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & git @GitArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  return @{ Exit = $code; Output = $out }
}

function Remove-TestRepoSafely([string]$dir) {
  if (-not $dir) { return }
  if (-not (Test-Path -LiteralPath $dir)) { return }
  $resolved = (Resolve-Path -LiteralPath $dir).Path
  if (-not $resolved.StartsWith($TestDirRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "refusing cleanup outside orchestration/tests: $resolved"
  }
  $leaf = Split-Path $resolved -Leaf
  if (-not $leaf.StartsWith("tmp-", [StringComparison]::OrdinalIgnoreCase)) {
    throw "refusing cleanup without tmp- prefix: $leaf"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}

function New-TestRepo {
  $dir = Join-Path $PSScriptRoot ("tmp-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $dir "orchestration\prompts") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $dir "docs\design") | Out-Null
  Copy-Item -Path $Orchestrate -Destination (Join-Path $dir "orchestration\orchestrate.ps1")
  Copy-Item -Path $WorktreeHelpers -Destination (Join-Path $dir "orchestration\worktree-helpers.ps1")
  Copy-Item -Path (Join-Path $SourcePrompts "*") -Destination (Join-Path $dir "orchestration\prompts")
  Set-Content -Path (Join-Path $dir "docs\design\REQ-0001-product.md") -Value "ready" -Encoding UTF8
  Set-Content -Path (Join-Path $dir "README.md") -Value "test" -Encoding UTF8
  Push-Location $dir
  try {
    $init = Invoke-NativeGit -GitArgs @("init")
    if ($init.Exit -ne 0) { throw "git init failed" }
    $add = Invoke-NativeGit -GitArgs @("add", "-A")
    if ($add.Exit -ne 0) { throw "git add failed" }
    $commit = Invoke-NativeGit -GitArgs @("commit", "-m", "init")
    if ($commit.Exit -ne 0) { throw "git commit failed" }
  } finally {
    Pop-Location
  }
  return $dir
}

function Write-MinimalTaskTree([string]$Repo, $TaskOverrides) {
  $tree = @{
    version = 1
    feature_id = "TEST"
    gate = @{
      feature_preparation = "ready"
      implementation_allowed = $true
    }
    tasks = @(
      @{
        id = "T-TEST"
        title = "test task"
        owner_role = "worker"
        status = "ready"
        deps = @()
        seams = $TaskOverrides.seams
        decisions = $TaskOverrides.decisions
        done_when = $TaskOverrides.done_when
        stop_when = @("stop")
        notes = "note"
        verification = @{ planned = @(); run = @() }
      }
    )
  }
  $path = Join-Path $Repo "orchestration\task-tree.json"
  $tree | ConvertTo-Json -Depth 12 | Set-Content -Path $path -Encoding UTF8
}

function Invoke-Orchestrate([string]$Repo, [string[]]$OrchestrateArgs) {
  $script = Join-Path $Repo "orchestration\orchestrate.ps1"
  Push-Location $Repo
  try {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @OrchestrateArgs 2>&1
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prev
    }
    $text = ($out | ForEach-Object { "$_" }) -join "`n"
    return @{ Exit = $code; Text = $text }
  } finally {
    Pop-Location
  }
}

function Invoke-GitWorktreeAddInRepo([string]$Repo, [string]$Branch, [string]$WtPath) {
  Push-Location $Repo
  try {
    $r = Invoke-NativeGit -GitArgs @("worktree", "add", "-b", $Branch, $WtPath, "HEAD")
    if ($r.Exit -ne 0) { throw "git worktree add failed (exit $($r.Exit))" }
  } finally {
    Pop-Location
  }
}

# --- Join-Lines / Join-Bullets via prompt (DEC-0008 collection shapes) ---
$repoPrompt = New-TestRepo
try {
  Write-MinimalTaskTree $repoPrompt @{
    seams = "S-only"
    decisions = "DEC-0008"
    done_when = "one item"
  }
  $r = Invoke-Orchestrate $repoPrompt @("prompt", "T-TEST")
  Assert-True ($r.Exit -eq 0) "prompt scalar exit"
  $text = $r.Text
  Assert-True ($text -match "S-only") "prompt scalar seam"
  Assert-True ($text -match "DEC-0008") "prompt scalar decision"
  Assert-True ($text -match "- one item") "prompt scalar done_when"

  Write-MinimalTaskTree $repoPrompt @{
    seams = @()
    decisions = @()
    done_when = @()
  }
  $r = Invoke-Orchestrate $repoPrompt @("prompt", "T-TEST")
  Assert-True ($r.Exit -eq 0) "prompt empty exit"
  $text = $r.Text
  Assert-True ($text -match "Seams permitidos: \(none\)") "prompt empty seams"
  Assert-True ($text -match "- \(none\)") "prompt empty done_when"

  Write-MinimalTaskTree $repoPrompt @{
    seams = @("S-a", "S-b")
    decisions = @("DEC-1", "DEC-2")
    done_when = @("a", "b")
  }
  $r = Invoke-Orchestrate $repoPrompt @("prompt", "T-TEST")
  Assert-True ($r.Exit -eq 0) "prompt multiple exit"
  $text = $r.Text
  Assert-True ($text -match "S-a, S-b") "prompt multiple seams"
  Assert-True ($text -match "- a`n- b") "prompt multiple done_when bullets"
} finally {
  Remove-TestRepoSafely $repoPrompt
}

# --- spawn: fresh ---
$repoSpawn = New-TestRepo
try {
  Write-MinimalTaskTree $repoSpawn @{
    seams = @("S-orch")
    decisions = @("DEC-0008")
    done_when = @("done")
  }
  $r = Invoke-Orchestrate $repoSpawn @("spawn", "T-TEST")
  Assert-True ($r.Exit -eq 0) "spawn fresh exit"
  Assert-True ($r.Text -match "spawned T-TEST") "spawn fresh"
  $wt = Join-Path $repoSpawn "orchestration\worktrees\T-TEST"
  Assert-True (Test-Path (Join-Path $wt "PROMPT.md")) "spawn writes PROMPT"
  Assert-True (Test-Path (Join-Path $wt "HANDOFF.md")) "spawn writes HANDOFF"
} finally {
  Remove-TestRepoSafely $repoSpawn
}

# --- spawn: partial (worktree only, no artifacts) ---
$repoPartial = New-TestRepo
try {
  Write-MinimalTaskTree $repoPartial @{
    seams = @("S-orch")
    decisions = @("DEC-0008")
    done_when = @("done")
  }
  $wt = Join-Path $repoPartial "orchestration\worktrees\T-TEST"
  New-Item -ItemType Directory -Force -Path (Split-Path $wt) | Out-Null
  Invoke-GitWorktreeAddInRepo -Repo $repoPartial -Branch "agent/T-TEST" -WtPath $wt
  $r = Invoke-Orchestrate $repoPartial @("spawn", "T-TEST")
  Assert-True ($r.Exit -eq 0) "partial spawn exit"
  Assert-True ($r.Text -match "resumed T-TEST") "partial spawn resumes"
  Assert-True (Test-Path (Join-Path $wt "PROMPT.md")) "partial spawn writes PROMPT"
  Assert-True (Test-Path (Join-Path $wt "HANDOFF.md")) "partial spawn writes HANDOFF"
} finally {
  Remove-TestRepoSafely $repoPartial
}

# --- spawn: matching worktree preserves HANDOFF evidence ---
$repoPreserve = New-TestRepo
try {
  Write-MinimalTaskTree $repoPreserve @{
    seams = @("S-orch")
    decisions = @("DEC-0008")
    done_when = @("done")
  }
  $r = Invoke-Orchestrate $repoPreserve @("spawn", "T-TEST")
  Assert-True ($r.Exit -eq 0) "preserve setup spawn exit"
  Assert-True ($r.Text -match "spawned") "preserve setup spawn"
  $wt = Join-Path $repoPreserve "orchestration\worktrees\T-TEST"
  $evidence = @"
task_id: T-TEST
verification:
  run:
    - manual planner evidence
"@
  Set-Content -Path (Join-Path $wt "HANDOFF.md") -Value $evidence -Encoding UTF8
  $r2 = Invoke-Orchestrate $repoPreserve @("spawn", "T-TEST")
  Assert-True ($r2.Exit -eq 0) "preserve resume exit"
  Assert-True ($r2.Text -match "resumed") "preserve resume"
  $handoffAfter = Get-Content -Raw (Join-Path $wt "HANDOFF.md")
  Assert-True ($handoffAfter -match "manual planner evidence") "preserve HANDOFF verification"
} finally {
  Remove-TestRepoSafely $repoPreserve
}

# --- spawn: mismatched path rejected ---
$repoMismatch = New-TestRepo
try {
  Write-MinimalTaskTree $repoMismatch @{
    seams = @("S-orch")
    decisions = @("DEC-0008")
    done_when = @("done")
  }
  $wt = Join-Path $repoMismatch "orchestration\worktrees\T-TEST"
  New-Item -ItemType Directory -Force -Path $wt | Out-Null
  Set-Content -Path (Join-Path $wt "stray.txt") -Value "not a worktree" -Encoding UTF8
  $r = Invoke-Orchestrate $repoMismatch @("spawn", "T-TEST")
  Assert-True ($r.Exit -ne 0) "mismatched path nonzero exit"
  $rejected = ($r.Text -match "not a registered git worktree|not part of this repository")
  Assert-True $rejected "mismatched path rejected"
  Assert-True (Test-Path (Join-Path $wt "stray.txt")) "mismatched path keeps stray evidence"
} finally {
  Remove-TestRepoSafely $repoMismatch
}

# --- spawn: wrong branch rejected ---
$repoBranch = New-TestRepo
try {
  Write-MinimalTaskTree $repoBranch @{
    seams = @("S-orch")
    decisions = @("DEC-0008")
    done_when = @("done")
  }
  $wt = Join-Path $repoBranch "orchestration\worktrees\T-TEST"
  New-Item -ItemType Directory -Force -Path (Split-Path $wt) | Out-Null
  Invoke-GitWorktreeAddInRepo -Repo $repoBranch -Branch "wrong-branch" -WtPath $wt
  $r = Invoke-Orchestrate $repoBranch @("spawn", "T-TEST")
  Assert-True ($r.Exit -ne 0) "wrong branch nonzero exit"
  Assert-True ($r.Text -match "expected 'agent/T-TEST'") "wrong branch rejected"
} finally {
  Remove-TestRepoSafely $repoBranch
}

if (@($script:failures).Count -gt 0) {
  Write-Output "FAILED:"
  $script:failures | ForEach-Object { Write-Output "  - $_" }
  exit 1
}

Write-Output "OK: all orchestration tests passed"
exit 0
