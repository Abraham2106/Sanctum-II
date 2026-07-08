$vault = "C:\Users\solan\Documents\Personal\Desarrollo_y_Proyectos\Sanctum-II\prueba"
$pluginDir = "$vault\.obsidian\plugins\sanctum-ii"

Copy-Item main.js,manifest.json,styles.css $pluginDir -Force

if (Test-Path "sanctum-agents") {
    New-Item -ItemType Directory -Path "$vault\sanctum-agents" -Force
    Copy-Item "sanctum-agents\*.md" "$vault\sanctum-agents\" -Force
}

New-Item -ItemType Directory -Path "$vault\sanctum-logs\traces" -Force

Write-Output "Deploy completado a $vault"
