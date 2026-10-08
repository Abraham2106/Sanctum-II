#Requires -Version 5.1
<#
.SYNOPSIS
  Planner/worker orchestrator: status, prompt render, git worktrees.
  Does not call Cursor. Does not implement product code.
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet("help", "status", "prompt", "spawn", "review", "finish", "validate", "preflight", "notify", "run")]
  [string]$Command = "help",

  [Parameter(Position = 1)]
  [string]$TaskId,

  [Parameter(Position = 2)]
  [ValidateSet("draft", "blocked", "ready", "in_progress", "review", "done", "killed")]
  [string]$NewStatus
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "worktree-helpers.ps1")

function Get-RepoRoot {
  $here = $PSScriptRoot
  if (-not $here) { $here = Get-Location }
  return (Resolve-Path (Join-Path $here "..")).Path
}

function Get-TaskTreePath([string]$Root) {
  return Join-Path $Root "orchestration\task-tree.json"
}

function Read-TaskTree([string]$Root) {
  $path = Get-TaskTreePath $Root
  if (-not (Test-Path $path)) { throw "Missing $path" }
  return (Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json)
}

function Write-TaskTree([string]$Root, $Tree) {
  $path = Get-TaskTreePath $Root
  $json = $Tree | ConvertTo-Json -Depth 12
  Set-Content -Path $path -Value $json -Encoding UTF8
}

function Find-Task($Tree, [string]$Id) {
  $t = @($Tree.tasks | Where-Object { $_.id -eq $Id })
  if (@($t).Count -ne 1) { throw "Task $Id not found (or duplicated)" }
  return $t[0]
}

function Test-DepsDone($Tree, $Task) {
  foreach ($d in @($Task.deps)) {
    if (-not $d) { continue }
    $dep = Find-Task $Tree $d
    if ($dep.status -ne "done") { return $false }
  }
  return $true
}

function Get-GitSha([string]$Root) {
  Push-Location $Root
  try {
    $r = Invoke-GitCommand -GitArgs @("rev-parse", "HEAD")
    if ($r.ExitCode -ne 0 -or -not $r.Output) { return "NO_COMMITS" }
    $sha = ($r.Output | ForEach-Object { "$_" }).Trim()
    if (-not $sha) { return "NO_COMMITS" }
    return $sha
  } finally {
    Pop-Location
  }
}

function Render-Template([string]$TemplatePath, [hashtable]$Map) {
  $text = Get-Content -Raw -Encoding UTF8 $TemplatePath
  foreach ($k in $Map.Keys) {
    $text = $text.Replace("{{" + $k + "}}", [string]$Map[$k])
  }
  return $text
}

# DEC-0002: JSON scalars and single pipeline hits are not arrays; .Count breaks in strict mode.
function Normalize-StringList($value) {
  if ($null -eq $value) { return ,@() }
  if ($value -is [string]) {
    if (-not $value) { return ,@() }
    return ,@($value)
  }
  $raw = @($value | ForEach-Object {
      if ($null -eq $_) { return }
      "$_"
    })
  return ,@($raw | Where-Object { $_ })
}

function Get-ListCount($value) {
  return @(Normalize-StringList $value).Count
}

function Join-Lines($arr) {
  $items = Normalize-StringList $arr
  if ($items.Count -eq 0) { return "(none)" }
  return ($items -join ", ")
}

function Join-Bullets($arr) {
  $items = Normalize-StringList $arr
  if ($items.Count -eq 0) { return "- (none)" }
  return (($items | ForEach-Object { "- $_" }) -join "`n")
}

function Assert-Spawnable($Tree, $Task, [bool]$Resuming = $false) {
  if ($Task.owner_role -eq "worker") {
    if (-not $Tree.gate.implementation_allowed) {
      throw "INVALID_INPUT: FEATURE-PREPARATION blocked. No worker spawn. Ingest requirements first."
    }
    $okStatus = @("ready")
    if ($Resuming) { $okStatus += "in_progress" }
    if ($Task.status -notin $okStatus) {
      throw "INVALID_INPUT: $($Task.id) status=$($Task.status) (need ready)"
    }
  }
  if ($Task.status -eq "killed") { throw "Task killed" }
  if (-not (Test-DepsDone $Tree $Task)) {
    throw "INVALID_INPUT: unmet deps for $($Task.id)"
  }
}

function Invoke-Notify {
  param(
    [string]$Root,
    [string]$Reason,
    [string]$Message
  )
  if (-not $Reason) { $Reason = "unspecified" }
  if (-not $Message) { $Message = $Reason }
  $dir = Join-Path $Root "orchestration\runs"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $stamp = Get-Date -Format "o"
  $body = @"
time: $stamp
reason: $Reason
message: $Message
"@
  Set-Content -Path (Join-Path $dir "NOTIFY.md") -Value $body -Encoding UTF8
  Set-Content -Path (Join-Path $dir ("NOTIFY-" + ($stamp -replace "[:.]","-") + ".md")) -Value $body -Encoding UTF8
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch { }
  Write-Output "NOTIFY $Reason"
  Write-Output $Message
}

function Invoke-Preflight([string]$Root) {
  $req = Join-Path $Root "docs\design\REQ-0001-product.md"
  $errors = @()
  if (-not (Test-Path $req)) {
    $errors += "missing docs/design/REQ-0001-product.md"
  } else {
    $hits = @(Select-String -Path $req -Pattern "UNANSWERED" -SimpleMatch)
    if (@($hits).Count -gt 0) {
      $errors += "REQ-0001 still has $(@($hits).Count) UNANSWERED line(s)"
    }
  }
  if (@($errors).Count -gt 0) {
    return @{ Ok = $false; Errors = $errors }
  }
  return @{ Ok = $true; Errors = @() }
}

function Invoke-Run([string]$Root, $Tree) {
  $pf = Invoke-Preflight $Root
  if (-not $pf.Ok) {
    $msg = ($pf.Errors -join "; ")
    Invoke-Notify -Root $Root -Reason "hard_block" -Message $msg
    throw "HARD_BLOCK: $msg"
  }
  Write-Output "preflight: ok"
  Write-Output "autonomous run is cleared. Next: planner T-000 with dropped docs; do not ping the human until done/killed/hard-block."
}
function Show-Help {
  @"
swarm-build orchestrator

  preflight              Falla si REQ-0001 falta o tiene UNANSWERED
  run                    preflight + (si ok) marca listo para run autónomo
  notify <reason>        Escribe orchestration/runs/NOTIFY.md y beep
  status                 Task register + gate
  validate               Schema-ish checks
  prompt <id>            Prompt del owner_role
  spawn <id>             git worktree + HANDOFF.md
  review <id>            Reviewer prompt; status=review
  finish <id> <status>   Set status

Autónomo: cero preguntas mid-run. Notify: done | killed | hard-block.
Workers never write on main. Implementation spawn denied while gate blocked.
"@
}

function Show-Status($Tree) {
  Write-Output ("gate.feature_preparation = " + $Tree.gate.feature_preparation)
  Write-Output ("gate.implementation_allowed = " + $Tree.gate.implementation_allowed)
  Write-Output ""
  "{0,-8} {1,-10} {2,-10} {3}" -f "ID", "ROLE", "STATUS", "TITLE"
  "{0,-8} {1,-10} {2,-10} {3}" -f "--", "----", "------", "-----"
  foreach ($t in $Tree.tasks) {
    "{0,-8} {1,-10} {2,-10} {3}" -f $t.id, $t.owner_role, $t.status, $t.title
  }
}

function Invoke-Validate($Tree) {
  $ids = @{}
  foreach ($t in $Tree.tasks) {
    if ($ids.ContainsKey($t.id)) { throw "Duplicate $($t.id)" }
    $ids[$t.id] = $true
    foreach ($d in @($t.deps)) {
      if ($d -and -not ($Tree.tasks | Where-Object { $_.id -eq $d })) {
        throw "Dangling dep $d on $($t.id)"
      }
    }
    if ($t.owner_role -eq "worker" -and $t.status -eq "ready" -and -not $Tree.gate.implementation_allowed) {
      throw "Worker $($t.id) is ready but gate closed"
    }
  }
  Write-Output "validate: ok ($($Tree.tasks.Count) tasks)"
}

function Get-PromptMap($Task, [string]$BaseRef) {
  return @{
    TASK_ID     = $Task.id
    BASE_REF    = $BaseRef
    SEAMS       = (Join-Lines $Task.seams)
    DECISIONS   = (Join-Lines $Task.decisions)
    RESUME_FROM = $(if ($Task.notes) { $Task.notes } else { "(empty)" })
    DONE_WHEN   = (Join-Bullets $Task.done_when)
  }
}

function Build-HandoffText($Task, [string]$Base, [string]$Id, [string]$Branch) {
  $seams = (Join-Lines $Task.seams)
  $decs = (Join-Lines $Task.decisions)
  return @"
task_id: $($Task.id)
from_role: planner
to_role: $($Task.owner_role)
base_ref: $Base
worktree: orchestration/worktrees/$Id
branch: $Branch
seams: [$seams]
decisions: [$decs]
resume_from: |
  $($Task.notes)
done_when:
$(Join-Bullets $Task.done_when)
stop_when:
$(Join-Bullets $Task.stop_when)
verification:
  planned: []
  run: []
goldens_exposed: false
alarms: []
"@
}

function Show-Prompt([string]$Root, $Tree, [string]$Id) {
  $task = Find-Task $Tree $Id
  $role = $task.owner_role
  $tpl = Join-Path $Root "orchestration\prompts\$role.md"
  if (-not (Test-Path $tpl)) { throw "No prompt template for $role" }
  $map = Get-PromptMap $task (Get-GitSha $Root)
  Write-Output (Render-Template $tpl $map)
}

function Invoke-Spawn([string]$Root, $Tree, [string]$Id) {
  $wtParent = Join-Path $Root "orchestration\worktrees"
  New-Item -ItemType Directory -Force -Path $wtParent | Out-Null
  $wt = Join-Path $wtParent $Id
  $branch = "agent/$Id"
  $resuming = Test-Path $wt

  $task = Find-Task $Tree $Id
  Assert-Spawnable $Tree $task $resuming

  $base = Get-GitSha $Root
  if ($base -eq "NO_COMMITS") {
    throw "INVALID_INPUT: repo has no commits. Commit the docs base on main first, then spawn."
  }

  $role = $task.owner_role
  $tpl = Join-Path $Root "orchestration\prompts\$role.md"
  if (-not (Test-Path $tpl)) { throw "No prompt template for $role" }
  $map = Get-PromptMap $task $base
  $prompt = Render-Template $tpl $map
  $handoff = Build-HandoffText $task $base $Id $branch

  if ($resuming) {
    Assert-WorktreeMatchesTask $Root $wt $branch
  }

  if (-not $resuming) {
    Invoke-GitWorktreeAdd -Root $Root -Branch $branch -WtPath $wt
  }

  Write-SpawnArtifacts -Wt $wt -Prompt $prompt -HandoffText $handoff

  $task.status = "in_progress"
  Write-TaskTree $Root $Tree

  if ($resuming) {
    Write-Output "resumed $Id"
  } else {
    Write-Output "spawned $Id"
  }
  Write-Output "worktree $wt"
  Write-Output "branch   $branch"
  Write-Output "open PROMPT.md in a Cursor Agent chat with the $role model"
}

function Invoke-Review([string]$Root, $Tree, [string]$Id) {
  $task = Find-Task $Tree $Id
  $wt = Join-Path $Root "orchestration\worktrees\$Id"
  if (-not (Test-Path $wt)) { throw "No worktree for $Id; spawn first" }
  $task.status = "review"
  Write-TaskTree $Root $Tree
  $tpl = Join-Path $Root "orchestration\prompts\reviewer.md"
  $map = @{ BASE_REF = (Get-GitSha $Root) }
  Write-Output (Render-Template $tpl $map)
  Write-Output ""
  Write-Output "Review the diff inside $wt (git diff $($map.BASE_REF))"
}

function Invoke-Finish([string]$Root, $Tree, [string]$Id, [string]$Status) {
  if (-not $Status) { throw "finish requires a status" }
  $task = Find-Task $Tree $Id
  $task.status = $Status
  Write-TaskTree $Root $Tree
  Write-Output "$Id -> $Status"
}

$root = Get-RepoRoot
$tree = Read-TaskTree $root

switch ($Command) {
  "help" { Show-Help }
  "status" { Show-Status $tree }
  "validate" { Invoke-Validate $tree }
  "prompt" {
    if (-not $TaskId) { throw "prompt requires task id" }
    Show-Prompt $root $tree $TaskId
  }
  "spawn" {
    if (-not $TaskId) { throw "spawn requires task id" }
    Invoke-Spawn $root $tree $TaskId
  }
  "review" {
    if (-not $TaskId) { throw "review requires task id" }
    Invoke-Review $root $tree $TaskId
  }
  "finish" {
    if (-not $TaskId) { throw "finish requires task id" }
    Invoke-Finish $root $tree $TaskId $NewStatus
  }
  "preflight" {
    $pf = Invoke-Preflight $root
    if ($pf.Ok) {
      Write-Output "preflight: ok"
    } else {
      $pf.Errors | ForEach-Object { Write-Output $_ }
      exit 1
    }
  }
  "notify" {
    $reason = $TaskId
    if (-not $reason) { $reason = "unspecified" }
    Invoke-Notify -Root $root -Reason $reason -Message $reason
  }
  "run" { Invoke-Run $root $tree }
}
