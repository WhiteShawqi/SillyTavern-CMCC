# 发布到 GitHub

> git 已装好、仓库已初始化。**但国内直连 GitHub 大概率连不上**，
> 需要先开代理。详见下面第 1 节。

---

## 0. 先说结论：你之前"连不上"的真实原因

我实测过，**不是 git 装错了，也不是配置错了**：

```
DNS 解析    github.com → 20.205.243.166         ✓ 正常
TCP 端口    github.com:443                      时通时不通
git ls-remote https://github.com/git/git.git    实测 0/5 成功
```

典型症状：**TCP 端口能通，但 HTTP 层被重置**（`ERR_CONNECTION_RESET`），
`push` 会卡 20~35 秒然后失败。这是国内直连 GitHub 的常见情况。

再看你机器上的代理状态：

```
iKuuuVPN 进程      : 在跑（F:\ikuuu_vpn）
iKuuu 外连         : 192.168.1.49 → 23.149.108.16:443   （有一条活跃连接）
虚拟网卡(TUN)       : 没有
默认路由           : 192.168.1.1（普通网卡）← 流量没走 VPN
系统代理开关       : 关（ProxyEnable = 0）
系统代理地址       : 127.0.0.1:7890（但那个端口没有服务在听）
```

**所以：iKuuu 客户端开着，但它的代理作用没有传导到系统 / 浏览器 / git。**

---

## 1. 你要做的（关键）

打开 **iKuuuVPN**，然后做到这两点之一：

| 方式 | 怎么做 | 效果 |
|---|---|---|
| **开系统代理**（推荐） | 客户端里找「系统代理 / System Proxy」开关，打开 | 浏览器和 git 都跟着走代理 |
| **开 TUN 模式** | 客户端里找「TUN 模式 / 虚拟网卡」开关，打开 | 全局流量接管，最省心 |

> 你的系统代理地址预设是 `127.0.0.1:7890`（Clash 系标准端口）。
> 如果 iKuuu 用的是别的端口，开着系统代理时它会自己改写这个值。

**验证是否生效**（在这个窗口里跑）：

```powershell
Test-NetConnection github.com -Port 443 -InformationLevel Quiet   # 要 True
git ls-remote https://github.com/git/git.git HEAD                  # 要能秒回一行哈希
```

第二条能秒回，才说明 git 走通了。

---

## 2. 一键推送

1. 先建空仓库：<https://github.com/new>
   - **Repository name**：`SillyTavern-CMCC`
   - **Public**
   - **不要**勾 Add README / .gitignore / license（我们都有）
   - 点 **Create repository**

2. 双击项目根目录的 **[push-to-github.bat]**

3. 脚本会自己：
   - 检查 git
   - **预检 GitHub 连通性**（连不上会停下来提醒你开代理，而不是白等 35 秒）
   - 问一次你的 GitHub 用户名（记住）
   - 配 remote
   - 推 main（失败自动重试 3 次）
   - 推全部标签

4. 首次推送会**弹浏览器让你登录 GitHub** → 授权即可

---

## 3. 手动命令（想自己敲）

```powershell
cd 'D:\下载\SillyTavern-CMCC'

git remote add origin https://github.com/<你的用户名>/SillyTavern-CMCC.git
git push -u origin main
git push --tags          # 15 个版本标签
```

推失败了就多重试几次 —— 直连不稳，有时候碰巧能过。

---

## 4. 如果代理开了还是连不上

按这个顺序试：

1. **换节点**（iKuuu 里换个线路，有的节点被墙了）
2. **确认是全局/TUN 而不是规则模式**（规则模式可能把 github.com 走了直连）
3. **给 git 单独指定代理**（把端口换成你代理软件实际监听的）：

   ```powershell
   git config --global http.proxy  http://127.0.0.1:7890
   git config --global https.proxy http://127.0.0.1:7890
   ```

   用完想取消：

   ```powershell
   git config --global --unset http.proxy
   git config --global --unset https.proxy
   ```

   > 默认是**留空**的，留空时 git 自动跟随系统代理。

4. **改 hosts**（治标，IP 会变，不建议长期用）
5. **最后手段**：用 GitHub 网页拖拽上传（见第 7 节）

---

## 5. 本机 git 装在哪

**PortableGit 2.56.0（绿色版）** —— 没有开始菜单、没有桌面图标：

```
D:\tools\PortableGit\
├── cmd\git.exe          ← PATH 指向这里
├── ucrt64\bin\          ← 凭据管理器 git-credential-manager.exe
└── PortableGit.7z.exe   ← 原始安装包 57MB，可删
```

已配好的：

| 配置 | 值 |
|---|---|
| PATH（用户级） | 含 `D:\tools\PortableGit\cmd` 和 `...\ucrt64\bin` |
| `core.quotepath` | `false`（中文文件名正常） |
| `init.defaultBranch` | `main` |
| `credential.helper` | `manager`（弹浏览器登录） |
| `credential.managerPath` | 指向 ucrt64 里的 GCM |
| `http.proxy` / `https.proxy` | 留空（自动跟随系统代理） |

> 卸载：删 `D:\tools\PortableGit`，再去「环境变量」删那两条 PATH。

---

## 6. 推送后建议做的事

### 补上作者信息

`manifest.json` 里 `author` / `homePage` 现在是空的：

```json
{
    "author": "你的名字",
    "homePage": "https://github.com/<你的用户名>/SillyTavern-CMCC"
}
```

### 仓库 Topics

仓库页右侧 **About** → 齿轮 → **Topics**：

```
sillytavern
sillytavern-extension
ai-companion
persistent-memory
roleplay
```

---

## 7. 备选：完全不用命令行

GitHub 网页端支持拖拽上传（**这条也需要先能打开 GitHub**）：

1. 建好空仓库
2. 仓库页点 **uploading an existing file**
3. 把文件**连同 `src/` `tests/` `docs/` 子目录**一起拖进去

注意网页上传**不能拖整个文件夹**，要逐个进子目录传。
（或者装 GitHub Desktop，图形界面版 git。）

---

## 8. 当前仓库状态

```
分支 : main
提交 : 46deae1 chore: v0.8.0 GitHub 发布流程闭环
标签 : v0.4.0 ~ v0.8.0 共 15 个
remote: 未配置（脚本会配）
```

`.gitignore`：

```
node_modules/
*.log
.DS_Store
_notes/
tests/layout/_render/
tests/layout/topbar.js
.github-username
```
