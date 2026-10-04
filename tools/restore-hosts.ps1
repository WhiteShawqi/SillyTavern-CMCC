# 还原 hosts —— 撤销「修复GitHub直连」的修改
# 需要管理员权限。用「还原hosts.bat」会自动提权。

$ErrorActionPreference = 'Stop'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$MarkBegin = '# === CMCC: GitHub 直连（整段可删除以还原）==='
$MarkEnd   = '# === CMCC: GitHub 直连 结束 ==='

function Ok($m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [!!] $m" -ForegroundColor Red }

Write-Host ''
Write-Host '=== 还原 hosts ==='
Write-Host ''

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Bad '需要管理员权限。请用「还原hosts.bat」运行（它会自动提权）。'
    Read-Host '按回车关闭'
    exit 1
}

$lines = Get-Content $HostsPath -Encoding UTF8 -ErrorAction SilentlyContinue
$out = New-Object System.Collections.Generic.List[string]
$skip = $false
$removed = 0
foreach ($l in $lines) {
    $t = $l.Trim()
    if ($t -eq $MarkBegin) { $skip = $true; $removed++; continue }
    if ($t -eq $MarkEnd)   { $skip = $false; continue }
    if ($skip) { $removed++; continue }
    $out.Add($l)
}

if ($removed -eq 0) {
    Write-Host '  hosts 里没有找到我们添加的段落，无需还原。'
} else {
    # 备份当前内容
    $backupDir = Join-Path $PSScriptRoot '_hosts_backup'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item $HostsPath (Join-Path $backupDir ('hosts.before-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))) -Force
    Set-Content -Path $HostsPath -Value $out -Encoding UTF8
    Ok "已删除 $removed 行"
    ipconfig /flushdns | Out-Null
    Ok 'DNS 缓存已刷新'
}

Write-Host ''
$resolved = [System.Net.Dns]::GetHostAddresses('github.com') | ForEach-Object { $_.IPAddressToString }
Write-Host "  github.com 现在解析为: $($resolved -join ', ')"
Write-Host ''
Read-Host '按回车关闭'
