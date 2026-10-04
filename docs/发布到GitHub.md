# 发布到 GitHub

> **这台机器上 git 已经装好、仓库也已经初始化好了。**
> 你只需要：① 在网页上建个空仓库 ② 双击 `推送到GitHub.bat`。

---

## 你最可能卡住的地方

**"我连不上 GitHub"** —— 实测过，**网络是通的**：

```
DNS:  github.com → 20.205.243.166        ✓ 解析正常
git:  git ls-remote https://github.com/git/git.git
      → 8103b446517e0c44e67561b9d0ccce56efa60a71  HEAD    ✓ 连得上
代理: 未启用（系统代理 ProxyEnable=0）
```

真正的原因是**没有登录凭据**（Windows 凭据管理器里没有 github 条目）。
现在凭据管理器已经配好，第一次推送会**自动弹浏览器让你登录**。

---

## 一键推送（推荐）

1. 先在网页上建空仓库：<https://github.com/new>
   - **Repository name**：`SillyTavern-CMCC`
   - **Public**
   - **不要**勾 "Add a README / .gitignore / license"（我们都有了）
   - 点 **Create repository**

2. 双击项目根目录的 **[推送到GitHub.bat]**（或 `推送到GitHub.ps1`）

3. 按提示输入你的 GitHub 用户名（只问一次，之后记住）

4. 首次会弹浏览器 → 登录 GitHub → 授权

脚本会自动：配 remote → 推 main → 推全部标签

> 如果脚本被 SmartScreen 拦了，右键 → 属性 → 勾「解除锁定」，或者直接右键「使用 PowerShell 运行」。

---

## 手动命令（想自己敲的话）

```powershell
# git 不在 PATH 时用全路径；本机已经加进 PATH 了
cd 'D:\下载\SillyTavern-CMCC'

git remote add origin https://github.com/<你的用户名>/SillyTavern-CMCC.git
git push -u origin main
git push --tags          # ← 别忘了，14 个版本标签
```

---

## 本机 git 装在哪

**PortableGit 2.56.0（绿色版）** —— 所以没有开始菜单、没有桌面图标：

```
D:\tools\PortableGit\
├── cmd\git.exe          ← PATH 里指向的是这个
├── ucrt64\bin\          ← 凭据管理器在这里
│   └── git-credential-manager.exe
└── PortableGit.7z.exe   ← 原始安装包（57 MB，可以删）
```

已经配好的东西：

| 配置 | 值 |
|---|---|
| PATH（用户级） | 含 `D:\tools\PortableGit\cmd` 和 `...\ucrt64\bin` |
| `core.quotepath` | `false`（中文文件名正常显示） |
| `init.defaultBranch` | `main` |
| `credential.helper` | `manager`（弹浏览器登录） |
| `credential.managerPath` | 指向 ucrt64 里的 GCM |

> 如果以后想卸载 git，直接删 `D:\tools\PortableGit` 目录，
> 再去「环境变量」里把那两条 PATH 删掉即可。

---

## 推送后建议做的事

### 补上作者信息

`manifest.json` 里的 `author` / `homePage` 现在是空的：

```json
{
    "author": "你的名字",
    "homePage": "https://github.com/<你的用户名>/SillyTavern-CMCC"
}
```

改完提交推送即可。

### 仓库 Topics（方便别人搜到）

仓库页面右侧 **About** → 齿轮 → **Topics**：

```
sillytavern
sillytavern-extension
ai-companion
persistent-memory
roleplay
```

---

## 备选：完全不想用命令行

GitHub 网页端支持拖拽上传：

1. 建好空仓库
2. 仓库页面点 **uploading an existing file**
3. 把文件**连同 `src/` `tests/` `docs/` 子目录**一起拖进去

注意网页上传**不能拖整个文件夹**，需要逐个进子目录上传。
（或者装 GitHub Desktop，图形界面的 git。）

---

## 当前仓库状态

```
分支 : main
提交 : 22bd8f8 fix: v0.7.4 设置页抽屉初始状态与折叠动画
标签 : v0.4.0 ~ v0.7.4 共 14 个
remote: 未配置（脚本会配）
大小 : 见 `git count-objects -vH`
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
