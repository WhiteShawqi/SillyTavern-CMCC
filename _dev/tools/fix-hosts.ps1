# 修复 GitHub 直连 —— 把 github.com 固定到实测可用的 IP
# 需要管理员权限（改 hosts 必须）。用「修复GitHub直连.bat」会自动提权。
#
# 原理：github.com 的 DNS 解析会轮换到多个 IP，其中一些连不通
#       （实测 20.205.243.166 恒定超时），所以表现为"时通时不通"。
#       把它固定到一个能完成 TLS 握手的 IP 即可根治。

$ErrorActionPreference = 'Stop'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$MarkBegin = '# === CMCC: GitHub 直连（整段可删除以还原）==='
$MarkEnd   = '# === CMCC: GitHub 直连 结束 ==='

function Say($m) { Write-Host $m }
function Ok($m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [!!] $m" -ForegroundColor Red }

Write-Host ''
Write-Host '=========================================='
Write-Host '  修复 GitHub 直连'
Write-Host '=========================================='
Write-Host ''

# ── 0) 权限检查 ──
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Bad '需要管理员权限。请用「修复GitHub直连.bat」运行（它会自动提权）。'
    Read-Host '按回车关闭'
    exit 1
}
Ok '有管理员权限'

# ── 1) 实测哪些 IP 能完成 TLS 握手 ──
Say ''
Say '  正在实测候选 IP（每个最多等 6 秒）...'

$Candidates = @(
    '140.82.121.4', '140.82.121.3', '140.82.112.4', '140.82.113.4',
    '140.82.114.4', '140.82.116.3', '140.82.116.4',
    '20.205.243.168', '4.237.22.38', '4.228.31.150', '20.201.28.151'
)

# 回调：接受任何证书（只为探测可达性，不用于实际通信）
$acceptAll = [System.Net.Security.RemoteCertificateValidationCallback] {
    param($s, $c, $ch, $e) return $true
}

$good = @()
foreach ($ip in $Candidates) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($ip, 443, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(6000)) { $tcp.Close(); continue }
        $tcp.EndConnect($iar)
        $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, $acceptAll)
        $ssl.AuthenticateAsClient('github.com')
        $ssl.Close(); $tcp.Close()
        $good += $ip
        Write-Host "     [OK] $ip" -ForegroundColor Green
    } catch {
        Write-Host "     [--] $ip  不可用" -ForegroundColor DarkGray
    }
}

if ($good.Count -eq 0) {
    Bad '没有任何 IP 可用 —— 可能整个 GitHub 都被封了，需要走代理。'
    Read-Host '按回车关闭'
    exit 1
}
Ok "找到 $($good.Count) 个可用 IP"
$Primary = $good[0]
Say "  选用: $Primary"

# ── 2) 备份 hosts ──
$backupDir = Join-Path $PSScriptRoot '_hosts_backup'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $backupDir "hosts.bak-$stamp"
Copy-Item $HostsPath $backup -Force
Ok "已备份: $backup"

# ── 3) 写入 ──
$lines = Get-Content $HostsPath -Encoding UTF8 -ErrorAction SilentlyContinue
$out = New-Object System.Collections.Generic.List[string]
$skip = $false
foreach ($l in $lines) {
    $t = $l.Trim()
    if ($t -eq $MarkBegin) { $skip = $true; continue }
    if ($t -eq $MarkEnd)   { $skip = $false; continue }
    if (-not $skip) { $out.Add($l) }
}

$block = @()
$block += $MarkBegin
$block += '# github.com 的 DNS 会轮换到多个 IP，其中一些连不通（实测 20.205.243.166 恒定超时）。'
$block += '# 这里固定到实测可完成 TLS 握手的 IP。想还原就把下面整段删掉。'
$block += '# 以后若又连不上，多半是这些 IP 也失效了 —— 重新跑一次「修复GitHub直连.bat」即可。'
$block += ('{0,-20} github.com' -f $Primary)
$block += ('{0,-20} gist.github.com' -f $Primary)
$block += ('{0,-20} api.github.com' -f $Primary)
$block += ('{0,-20} codeload.github.com' -f $Primary)
$block += ('{0,-20} ssh.github.com' -f $Primary)
$block += ('{0,-20} raw.githubusercontent.com' -f '185.199.108.133')
$block += ('{0,-20} objects.githubusercontent.com' -f '185.199.108.133')
$block += $MarkEnd

$final = @()
if ($out.Count -gt 0) { $final += $out }
$final += ''
$final += $block

Set-Content -Path $HostsPath -Value $final -Encoding UTF8
Ok 'hosts 已更新'

# ── 4) 刷新 DNS ──
ipconfig /flushdns | Out-Null
Ok 'DNS 缓存已刷新'

# ── 5) 验证 ──
Say ''
Say '  正在验证...'
Start-Sleep -Seconds 1
$resolved = [System.Net.Dns]::GetHostAddresses('github.com') | ForEach-Object { $_.IPAddressToString }
Say "  github.com 现在解析为: $($resolved -join ', ')"

$gitExe = 'D:\tools\PortableGit\cmd\git.exe'
if (Test-Path $gitExe) {
    $env:GIT_TERMINAL_PROMPT = '0'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $gitExe -c http.connectTimeout=15 ls-remote https://github.com/git/git.git HEAD *>&1 | Out-Null
    $sw.Stop()
    if ($LASTEXITCODE -eq 0) {
        Ok "git 连 GitHub 成功（$([math]::Round($sw.Elapsed.TotalSeconds,1)) 秒）"
    } else {
        Bad 'git 还是连不上。可能是 SNI 层面被拦，那就只能用代理了。'
    }
} else {
    Say "  （没找到 $gitExe，跳过 git 验证）"
}

Write-Host ''
Ok '完成！现在可以直接双击「推送到GitHub.bat」推送了。'
Write-Host ''
Read-Host '按回车关闭'
