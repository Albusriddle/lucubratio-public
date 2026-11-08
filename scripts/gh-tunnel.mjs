// 本地 CONNECT 隧道：把 github.com 的流量改道到可达 IP
//
// 背景：本机 DNS 把 github.com 解析到 20.205.243.166，该 IP 的 443 完全不通；
// 而 140.82.112.3 / .113.3 / .114.3 都可用。hosts 需要管理员权限，改不了，
// 于是起一个本地 HTTP CONNECT 代理，只对 github.com 做"改道"，其余原样直连。
//
// 用法：
//   node scripts/gh-tunnel.mjs [--port 7899] [--ip 140.82.113.3] [--daemon]
//   然后：git -c http.proxy=http://127.0.0.1:7899 push <url> <ref>
//
// 注意：这是**本机排障工具**，不进构建链，也不会被 App 使用。

import net from 'node:net';
import tls from 'node:tls';
import { argv } from 'node:process';

const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const PORT = Number(arg('port', '7899'));
// 启动时自动探测：GitHub 的各入口 IP 会轮换，固定一个经常会挂
const CANDIDATES = ['140.82.112.3', '140.82.113.3', '140.82.114.3', '20.27.177.113'];

/** TCP+TLS 握手探测某个 IP 是否可用（3 秒超时） */
function probe(ip, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const t = Date.now();
    const sock = tls.connect({ host: ip, port: 443, servername: 'github.com', rejectUnauthorized: false });
    const done = (ok) => { try { sock.destroy(); } catch {} ; resolve({ ip, ok, ms: Date.now() - t }); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('secureConnect', () => done(true));
    sock.once('error', () => done(false));
  });
}

let GH_IP = arg('ip', '');
async function pickIp() {
  if (GH_IP) return GH_IP;
  const results = await Promise.all(CANDIDATES.map((ip) => probe(ip)));
  const good = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
  for (const r of results) console.log(`[tunnel] 探测 ${r.ip}: ${r.ok ? r.ms + 'ms' : '不通'}`);
  if (!good.length) {
    console.error('[tunnel] 所有候选 IP 都不通——先确认代理/网络');
    process.exit(1);
  }
  return good[0].ip;
}
// 只改道这些主机名（其余照常解析，避免影响别的东西）
const REWRITE = new Set(['github.com', 'www.github.com']);
const FALLBACK_IPS = CANDIDATES.slice();

const targetIp = (host) => (REWRITE.has(host) ? GH_IP : host);

const server = net.createServer((sock) => {
  sock.once('data', (buf) => {
    const head = buf.toString('latin1');
    const m = head.match(/^CONNECT\s+([^:\s]+):(\d+)\s+HTTP\/1\.[01]/i);
    if (!m) {
      // 非 CONNECT：直接拒绝（我们只做 HTTPS 隧道）
      sock.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
      return;
    }
    const host = m[1];
    const port = Number(m[2]);

    let upstream = net.connect({ host: targetIp(host), port });
    upstream.once('connect', () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(buf.subarray(head.indexOf('\r\n\r\n') + 4));
      sock.pipe(upstream);
      upstream.pipe(sock);
    });
    upstream.on('error', async (e) => {
      console.error(`[tunnel] ${host}:${port} → ${targetIp(host)} 失败：${e.code}`);
      if (!REWRITE.has(host)) { sock.destroy(); return; }
      // IP 在轮换：失败就重新探测，而不是固守启动时选的那个
      try {
        const fresh = await pickIp();
        if (fresh !== GH_IP) {
          GH_IP = fresh;
          console.error(`[tunnel] 重新探测到可用 IP ${fresh}，重试`);
        }
        const up2 = net.connect({ host: GH_IP, port });
        up2.once('connect', () => {
          sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          sock.pipe(up2);
          up2.pipe(sock);
        });
        up2.on('error', () => sock.destroy());
      } catch {
        sock.destroy();
      }
    });
    sock.on('error', () => upstream.destroy());
  });
});

GH_IP = await pickIp();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[tunnel] 127.0.0.1:${PORT} → github.com 改道 ${GH_IP}`);
  console.log(`[tunnel] 用法：git -c http.proxy=http://127.0.0.1:${PORT} push <url> <ref>`);
});
