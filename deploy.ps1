$vault = "C:\Users\solan\Documents\Personal\Desarrollo_y_Proyectos\Sanctum-II\prueba"
$pluginDir = "$vault\.obsidian\plugins\sanctum-ii"

Copy-Item main.js,manifest.json,styles.css $pluginDir -Force

if (Test-Path "sanctum-agents") {
    New-Item -ItemType Directory -Path "$vault\sanctum-agents" -Force
    Copy-Item "sanctum-agents\*.md" "$vault\sanctum-agents\" -Force
}

if (Test-Path "sanctum-skills") {
    New-Item -ItemType Directory -Path "$vault\sanctum-skills" -Force
    Copy-Item "sanctum-skills\*.md" "$vault\sanctum-skills\" -Force
}

New-Item -ItemType Directory -Path "$vault\sanctum-chains" -Force
New-Item -ItemType Directory -Path "$vault\sanctum-logs\traces" -Force
New-Item -ItemType Directory -Path "$vault\sanctum-projects" -Force
New-Item -ItemType Directory -Path "$vault\Projects" -Force
New-Item -ItemType Directory -Path "$vault\sanctum-memory" -Force
New-Item -ItemType Directory -Path "$vault\sanctum-logs\threads" -Force
New-Item -ItemType Directory -Path "$vault\sanctum-logs\index" -Force

Write-Output "Deploy completado a $vault"
