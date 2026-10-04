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
& $GitExe push -u origin main
$code = $LASTEXITCODE
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
