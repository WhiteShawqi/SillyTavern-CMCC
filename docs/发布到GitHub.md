# 发布到 GitHub 步骤

> 这台机器目前**没有安装 git**（也没有 winget/choco/scoop）。
> 项目本身已经准备就绪，装好 git 后按下面几步即可。

---

## 1. 安装 git

任选一种：

**方式 A：官网安装包（最省事）**

下载 <https://git-scm.com/download/win> → 双击安装 → 一路默认即可。
装完**重开一个终端**，`git --version` 能出结果就行。

**方式 B：绿色版（不想装）**

下载 PortableGit 自解压版，解压到任意目录，然后用全路径调用，例如：

```powershell
& 'D:\PortableGit\cmd\git.exe' --version
```

---

## 2. 配置身份（只需一次）

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
git config --global core.quotepath false     # 让中文文件名正常显示
```

---

## 3. 初始化仓库并提交

```powershell
cd 'D:\下载\SillyTavern-CMCC'

git init -b main
git add -A
git commit -m "feat: 跨世界陪伴角色 (CMCC) v0.3.0"

# 确认提交内容（应该只有 11 个文件）
git log --oneline
git ls-files
```

---

## 4. 在 GitHub 上建仓库

1. 打开 <https://github.com/new>
2. **Repository name**：`SillyTavern-CMCC`
3. **Description**：
   ```
   跨世界陪伴角色 —— 一个固定的角色陪你玩任何卡，记得你们经历的一切
   ```
4. **Public**（开源）
5. **不要**勾选 "Add a README file / .gitignore / license"（我们已经有了）
6. 点 **Create repository**

---

## 5. 推送

把 `<你的用户名>` 换成你的 GitHub 用户名：

```powershell
cd 'D:\下载\SillyTavern-CMCC'

git remote add origin https://github.com/<你的用户名>/SillyTavern-CMCC.git
git push -u origin main
```

第一次推送会弹浏览器让你登录 GitHub，授权即可。

---

## 6. 推送后建议做的事

### 6.1 补上作者信息

编辑 `manifest.json`，填 `author` 和 `homePage`：

```json
{
    "author": "你的名字",
    "homePage": "https://github.com/<你的用户名>/SillyTavern-CMCC"
}
```

然后：

```powershell
git add manifest.json
git commit -m "chore: 填写作者与主页"
git push
```

### 6.2 打一个 tag

```powershell
git tag -a v0.3.0 -m "v0.3.0 记忆改存世界书 + 可视化编辑"
git push --tags
```

### 6.3 仓库 Topics（方便别人搜到）

在仓库页面右侧 **About** → 齿轮 → **Topics** 填：

```
sillytavern
sillytavern-extension
ai-companion
persistent-memory
roleplay
```

---

## 附：项目已就绪的东西

| 项 | 状态 |
|---|---|
| `manifest.json` | ✓ ST 扩展清单（version 0.3.0） |
| `index.js` / `src/` | ✓ 全部代码，语法检查通过 |
| `tests/test_core.mjs` | ✓ 82 项测试全部通过 |
| `README.md` | ✓ 含安装/使用/原理/限制/扩展点 |
| `LICENSE` | ✓ MIT |
| `.gitignore` | ✓ 已排除临时文件 |

`.gitignore` 内容：

```
node_modules/
*.log
.DS_Store
_notes/
```

---

## 附：手动上传（实在不想装 git）

GitHub 网页端支持直接拖拽上传：

1. 建好空仓库
2. 在仓库页面点 **uploading an existing file**
3. 把 `SillyTavern-CMCC` 里的文件**连同 src / tests 子目录**一起拖进去
4. Commit

注意：网页上传**不能拖整个文件夹**，需要进入 `src` 子目录分别上传里面的 4 个文件
（或者用 GitHub Desktop，它是图形界面的 git，也能免命令行）。
