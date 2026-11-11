# 排障手册

## 推送失败 / `github.com` 连不上

**现象**：`git push` 反复 `Failed to connect to github.com:443`；但 `api.github.com` 正常。

**根因**（本机实测）：DNS 把 `github.com` 解析到 `20.205.243.166`，该 IP 的 443 **完全不通**；
而 `140.82.11x.3`、`20.27.177.113` 等入口可用，且**会轮换**。与代理无关。

**诊断**

```bash
for ip in 140.82.112.3 140.82.113.3 140.82.114.3 20.27.177.113 20.205.243.166; do
  echo -n "$ip → "
  curl -s --ssl-no-revoke --max-time 8 --resolve github.com:443:$ip -o /dev/null -w "%{http_code}\n" https://github.com/
done
```

**修法一（改 hosts，需管理员）**

```
140.82.114.3 github.com
```

**修法二（不用管理员，推荐）**：起本地隧道，自动探测可用 IP 并改道

```bash
node scripts/gh-tunnel.mjs --port 7899 &
git -c http.proxy=http://127.0.0.1:7899 push <url> main
```

**修法三**：用重试脚本（会用 `ls-remote` 核对远端 SHA，避免"假成功"）

```bash
# token 走环境变量（脚本会通过 GIT_ASKPASS 传给 git，不出现在命令行/进程列表里）
GH_TOKEN=xxx scripts/push-retry.sh https://github.com/<owner>/<repo>.git main
# 需要走隧道时加 --proxy；token 也可放文件：--token-file /path/to/token
GH_TOKEN=xxx scripts/push-retry.sh https://github.com/<owner>/<repo>.git main --proxy http://127.0.0.1:7899
```

> 脚本还会**自动读取 Windows 系统代理**（`ProxyServer` 注册表项）：公司/校园网配了系统代理但
> `git` 不认时，它会自动用上；也可以用 `--proxy` 显式覆盖。
> 旧写法（把 `https://user:token@…` 直接当参数）仍兼容，但脚本会打印提醒——那样 token 会进进程列表。

### 为什么必须核对远端 SHA

`git push` 有时打印 `Everything up-to-date`，但远端其实没变（代理中断后的假象）。本仓库出过一次。
所以两个脚本都以 `git ls-remote` 的结果为准，而不是 push 的输出。

---

## 设备：adb 连上了但不是你以为的那台

**现象**：`ro.product.model` 显示 vivo，就以为是手机。

**教训**：MuMu 模拟器可以把机型信息伪装成任意真机。判断依据要看：

```bash
adb -s <serial> shell getprop ro.product.cpu.abi     # x86_64 → 模拟器
adb -s <serial> shell getprop ro.build.flavor        # missi_V2362A-user → MuMu
```

**踩坑**：本项目曾把模拟器当成用户真机，并据此宣称"清了你的数据"——实际没动过手机。

---

## 课程包导入报错

见 [`IMPORT.md`](IMPORT.md) 第 7 节「出错时看这里」（10 个错误码逐条解释）。
