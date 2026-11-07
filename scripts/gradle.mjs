// 跨平台执行 Android Gradle 任务：Windows 用 gradlew.bat，Unix 用 ./gradlew
// 用法：node scripts/gradle.mjs assembleDebug
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('用法: node scripts/gradle.mjs <gradle task> [args...]');
  process.exit(1);
}

const r = spawnSync(isWin ? 'gradlew.bat' : './gradlew', args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
});
process.exit(r.status === null ? 1 : r.status);
