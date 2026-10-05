<#
.SYNOPSIS
    从备份还原 CMCC 相关的酒馆数据。

.DESCRIPTION
    什么时候用：
      · 更新插件后出了 bug，把人设或记忆弄坏了
      · 想退回某个时间点的状态
      · 换电脑

    这个脚本**只覆盖你指定的部分**，默认什么都不动，要你显式选。

.EXAMPLE
    # 先看看有哪些备份、里面有什么
    .\restore-backup.ps1 -List

    # 只还原记忆（最常用）
    .\restore-backup.ps1 -BackupDir 'F:\PRTS AI\_backup-CMCC-20261005-162911' -What worlds

    # 全部还原（人设 + 记忆 + 聊天 + 角色卡 + 预设）
    .\restore-backup.ps1 -BackupDir '...' -What all
#>
[CmdletBinding()]
param(
    # 备份目录。不给就自动找最新的
    [string]$BackupDir = '',

    # 还原什么：worlds / settings / chats / characters / presets / all
    [string]$What = '',

    # 列出可用的备份
    [switch]$List,

    # 只演练，不真的写
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ST = 'F:\PRTS AI\SillyTavern'
$USERDIR = Join-Path $ST 'data\default-user'
$BACKUPROOT = 'F:\PRTS AI'

function Find-Backups {
    Get-ChildItem $BACKUPROOT -Directory -Filter '_backup-CMCC-*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
}

if ($List -or (-not $BackupDir -and -not $What)) {
    $all = Find-Backups
    if (-not $all) { Write-Host '没有找到任何备份（应该在 F:\PRTS AI\_backup-CMCC-*）'; exit 1 }
    Write-Host "找到 $($all.Count) 个备份：`n"
    foreach ($b in $all) {
        $files = Get-ChildItem $b.FullName -Recurse -File -ErrorAction SilentlyContinue
        $sum = ($files | Measure-Object Length -Sum).Sum
        Write-Host ("  {0}   {1,4} 个文件  {2,7:N1} MB" -f $b.Name, $files.Count, ($sum / 1MB))
        # 看看里面有没有 CMCC 的记忆库
        # ⚠ 这里**故意只判断存在性、不数条数**。
        #   世界书 JSON 里的换行是**字面的反斜杠+n**（不是真换行），
        #   数 "- " 开头的行会被标题行 "## 名字 - 时间" 干扰 ——
        #   我在这上面反复数错过。要看具体内容，直接打开那个 json 看。
        $wb = Join-Path $b.FullName 'data\worlds\CMCC-记忆库.json'
        if (Test-Path $wb) {
            Write-Host ("      ✓ 含 CMCC-记忆库（$([math]::Round((Get-Item $wb).Length/1KB,1)) KB）")
        } else {
            Write-Host '      · 不含 CMCC-记忆库'
        }
        $sj = Join-Path $b.FullName 'data\settings.json'
        if (Test-Path $sj) {
            $raw = Get-Content $sj -Raw -Encoding UTF8
            # ⚠ settings.json 里到处都有 "name"，直接抓会把预设提示词的名字也抓进来。
            #   只从 builtins 数组里取。
            $i = $raw.IndexOf('"builtins"')
            if ($i -ge 0) {
                $j = $raw.IndexOf('[', $i)
                $depth = 0; $k = $j
                while ($k -lt $raw.Length) {
                    if ($raw[$k] -eq '[') { $depth++ }
                    elseif ($raw[$k] -eq ']') { $depth--; if ($depth -eq 0) { break } }
                    $k++
                }
                $arr = $raw.Substring($j, $k - $j + 1)
                $names = [regex]::Matches($arr, '"name"\s*:\s*"([^"]*)"') |
                    ForEach-Object { $_.Groups[1].Value }
                Write-Host ("      人设预设：{0}" -f (($names | Where-Object { $_ }) -join ' / '))
            }
        }
        Write-Host ''
    }
    Write-Host '用法示例：'
    Write-Host "  .\restore-backup.ps1 -BackupDir '$($all[0].FullName)' -What worlds"
    exit 0
}

if (-not $BackupDir) {
    $BackupDir = (Find-Backups | Select-Object -First 1).FullName
    Write-Host "没指定备份目录，用最新的：$BackupDir"
}
if (-not (Test-Path $BackupDir)) { Write-Error "备份目录不存在：$BackupDir"; exit 2 }
if (-not $What) { Write-Error "没说要还原什么。用 -What worlds / settings / all ..."; exit 2 }

$MAP = @{
    worlds     = @{ src = 'data\worlds';            dst = 'worlds';            desc = '世界书（含 CMCC-记忆库 = 你全部的记忆）' }
    settings   = @{ src = 'data\settings.json';     dst = 'settings.json';     desc = '设置（含人设预设与插件设置）' }
    chats      = @{ src = 'data\chats';             dst = 'chats';             desc = '聊天记录' }
    characters = @{ src = 'data\characters';        dst = 'characters';        desc = '角色卡' }
    presets    = @{ src = 'data\OpenAI Settings';   dst = 'OpenAI Settings';   desc = '预设' }
}

$keys = if ($What -eq 'all') { $MAP.Keys } else { @($What) }
foreach ($k in $keys) {
    if (-not $MAP.ContainsKey($k)) { Write-Error "不认识的选项：$k（可选：$($MAP.Keys -join ' / ') / all）"; exit 2 }
}

Write-Host ''
Write-Host '════ 即将还原 ════'
Write-Host "  备份来源：$BackupDir"
Write-Host "  目标    ：$USERDIR"
Write-Host ''
foreach ($k in $keys) {
    $m = $MAP[$k]
    $s = Join-Path $BackupDir $m.src
    if (-not (Test-Path $s)) { Write-Host "  ✗ $k —— 备份里没有（跳过）"; continue }
    Write-Host "  ✓ $k —— $($m.desc)"
}

# 还原前先给当前状态再存一份，免得还原错了没法回头
if (-not $DryRun) {
    $safety = Join-Path $BACKUPROOT ("_backup-CMCC-before-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Write-Host ''
    Write-Host "还原前先把当前状态另存一份到："
    Write-Host "  $safety"
    New-Item -ItemType Directory -Path (Join-Path $safety 'data') -Force | Out-Null
    foreach ($k in $keys) {
        $m = $MAP[$k]
        $cur = Join-Path $USERDIR $m.dst
        if (Test-Path $cur) {
            Copy-Item $cur (Join-Path $safety ('data\' + (Split-Path $m.dst -Leaf))) -Recurse -Force
        }
    }
    Write-Host '  ✓ 已保存'
}

Write-Host ''
if ($DryRun) { Write-Host '（-DryRun：没有真的写任何东西）'; exit 0 }

$ans = Read-Host '确定要覆盖吗？输入 yes 继续'
if ($ans -ne 'yes') { Write-Host '已取消'; exit 0 }

foreach ($k in $keys) {
    $m = $MAP[$k]
    $s = Join-Path $BackupDir $m.src
    $d = Join-Path $USERDIR $m.dst
    if (-not (Test-Path $s)) { continue }
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    Copy-Item $s $d -Recurse -Force
    Write-Host "  ✓ 已还原 $k"
}

Write-Host ''
Write-Host '完成。**请重启 SillyTavern 并刷新页面**，否则浏览器里还是旧数据。'
