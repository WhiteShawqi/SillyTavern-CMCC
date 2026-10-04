# 推送到 GitHub —— 双击本文件即可（不用记命令）
# 首次运行会问一次你的 GitHub 用户名，之后记住。

$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = '推送 CMCC 到 GitHub'

$RepoDir  = 'D:\下载\SillyTavern-CMCC'
$GitExe   = 'D:\tools\PortableGit\cmd\git.exe'
$UserFile = Join-Path $RepoDir '.github-username'

function Say($m) { Write-Host $m }
function Ok($m)  { Write-Host "  [OK] $m"   -ForegroundColor Green }
function Bad($m) { Write-Host "  [!!] $m"   -ForegroundColor Red }
function Ask($m) { Write-Host "  [?] $m"    -ForegroundColor Yellow }

Clear-Host
Say '=========================================='
Say '  推送 跨世界陪伴角色 (CMCC) 到 GitHub'
Say '=========================================='
Say ''

# ── 1) 检查 git ──
if (-not (Test-Path $GitExe)) {
    Bad "找不到 git：$GitExe"
    Say ''
    Say 'PortableGit 可能被移动或删除了。'
    Read-Host '按回车关闭'
    exit 1
}
& $GitExe --version | Out-Null
Ok "git 可用（$(& $GitExe --version)）"

# ── 1.5) 预检 GitHub 连通性 ──
# 国内直连 GitHub 的典型症状：TCP 端口能通，但 HTTP 层被重置，
# 表现为 push 卡 20~35 秒然后失败。先探一次，早点告诉用户要开代理。
Say ''
Say '  正在检查 GitHub 连通性（最多等 30 秒）...'
$proxyOn = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -EA SilentlyContinue).ProxyEnable
$env:GIT_TERMINAL_PROMPT = '0'

function Test-GitHub {
    & $GitExe -c http.connectTimeout=10 ls-remote https://github.com/git/git.git HEAD *>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

if (Test-GitHub) {
    Ok '能连上 GitHub'
    if ($proxyOn -eq 1) { Say '     （系统代理开着）' }
} else {
    Bad '连不上 GitHub'
    Say ''
    Say '  [!] 国内直连 GitHub 经常失败（端口通但 HTTP 被重置）。'
    Say '      需要：打开代理软件 → 连上节点 → **开启「系统代理」**'
    Say ''
    Say "      当前系统代理开关: $(if ($proxyOn -eq 1) { '开' } else { '关  <-- 需要打开' })"
    Say ''
    $again = Read-Host '  开好代理后按回车重试（输入 s 跳过直接推送）'
    if ($again -ne 's' -and $again -ne 'S') {
        if (Test-GitHub) {
            Ok '现在能连上了'
        } else {
            Bad '还是连不上'
            Say '    继续推送大概率会失败或卡很久。'
            $go2 = Read-Host '  仍要继续？(y/N)'
            if ($go2 -ne 'y' -and $go2 -ne 'Y') { Say '  已取消'; Start-Sleep 2; exit 0 }
        }
    }
}
Say ''

# ── 2) 检查仓库 ──
if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
    Bad "这里不是 git 仓库：$RepoDir"
    Read-Host '按回车关闭'
    exit 1
}
Set-Location $RepoDir
Ok "仓库：$RepoDir"
Say ''

# ── 3) 要用户名 ──
$user = ''
if (Test-Path $UserFile) {
    $user = (Get-Content $UserFile -Raw).Trim()
    Ok "记住的 GitHub 用户名：$user"
} else {
    Say '  还不知道你的 GitHub 用户名。'
    Say '  （打开 https://github.com 右上角头像 → 看用户名；或看个人主页网址 github.com/xxx）'
    Say ''
    while (-not $user) {
        $user = (Read-Host '  请输入你的 GitHub 用户名').Trim()
        if (-not $user) { Bad '不能为空，再试一次' }
    }
    $user | Set-Content $UserFile -NoNewline -Encoding UTF8
    Ok "已记住：$user"
}
Say ''

# ── 4) 确认仓库已在 GitHub 建好 ──
$url = "https://github.com/$user/SillyTavern-CMCC.git"
Say "  将要推送到：$url"
Say ''
Ask '你已经在 GitHub 网页上建好这个空仓库了吗？'
Say '      没建的话现在去：https://github.com/new'
Say '        仓库名填 SillyTavern-CMCC'
Say '        选 Public'
Say '        不要勾 Add README / .gitignore / license（我们已有）'
Say ''
$go = Read-Host '  建好了就按回车继续（输入 n 退出）'
if ($go -eq 'n' -or $go -eq 'N') { Say '  已取消'; Start-Sleep 2; exit 0 }
Say ''

# ── 5) 配 remote ──
$existing = & $GitExe remote 2>$null
if ($existing -contains 'origin') {
    & $GitExe remote set-url origin $url
    Ok '已更新 origin'
} else {
    & $GitExe remote add origin $url
    Ok '已添加 origin'
}
Say ''

# ── 6) 推送 ──
Say '------------------------------------------'
Say '  开始推送（首次会弹浏览器让你登录 GitHub）'
Say '------------------------------------------'
Say ''
$code = 1
for ($try = 1; $try -le 3; $try++) {
    if ($try -gt 1) { Say "  第 $try 次尝试..."; Start-Sleep 3 }
    & $GitExe push -u origin main
    $code = $LASTEXITCODE
    if ($code -eq 0) { break }
}
Say ''

if ($code -eq 0) {
    Say '  主分支推好了，接着推标签（版本记录）...'
    & $GitExe push --tags
    Say ''
    Ok '全部完成！'
    Say ''
    Say "  你的仓库：https://github.com/$user/SillyTavern-CMCC"
} else {
    Bad "推送失败（退出码 $code）"
    Say ''
    Say '  常见原因：'
    Say '   1) 仓库还没在网页上建 —— 去 https://github.com/new 建一个同名的'
    Say '   2) 登录窗口里点了取消 —— 重新运行本脚本即可'
    Say '   3) 仓库名拼错了 —— 删掉本目录下的 .github-username 重新运行'
    Say '   4) 用户名不对 —— 同上'
}

Say ''
Read-Host '按回车关闭'
