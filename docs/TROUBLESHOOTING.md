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
scripts/push-retry.sh "$URL" main --proxy http://127.0.0.1:7899
```

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
