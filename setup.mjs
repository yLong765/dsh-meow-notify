// setup.mjs — meow-notify 安装补丁脚本
//
// 用途：把 meow-notify 加入 DSH 的 Web 设置允许列表（WEB_SETTINGS_NAMESPACES）。
//
// 背景（为什么需要）：DSH 的 host-apiproxy 硬编码了一个 Web 设置允许列表，
// 只有列表里的 settings namespace 才会被浏览器端 settings.describe 返回、
// 才能被 GUI 配置卡片读写。当前 DSH 版本（0.1.0-rc.x）第三方插件无法自行
// 暴露配置，必须把 namespace 加入这个列表（官方注释称此为 "deferred work"）。
//
// 用法：
//   node setup.mjs                    # 自动搜索常见安装位置
//   node setup.mjs <dsh安装目录>       # 显式指定 DSH 安装目录（npx 缓存/全局安装）
//   node setup.mjs --dry-run          # 只报告找到的文件，不修改
//
// 注意：
//   - 修改的是 DSH 安装副本，DSH 升级后补丁会丢失，重新运行本脚本即可。
//   - 补丁是幂等的：重复运行不会重复添加。
//   - 运行后需要重启 DSH 生效。
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const TARGET_NS = 'meow-notify';
const APIPROXY_REL = join('@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js');
const dryRun = process.argv.includes('--dry-run');
const explicit = process.argv.slice(2).find((a) => !a.startsWith('--'));

/** 收集候选的 DSH 安装根目录（其 node_modules 下应有 @deepseek-ai/dsh-host-apiproxy）。 */
function candidateRoots() {
  const roots = new Set();

  // 显式指定
  if (explicit) roots.add(explicit);

  // 本插件所在位置反推：
  //   已安装形态: <home>/profiles/node_modules/meow-notify/setup.mjs
  const here = dirname(fileURLToPath(import.meta.url));
  if (here.includes('profiles')) {
    const idx = here.indexOf('profiles');
    roots.add(here.slice(0, idx));
  }

  // 通过 require 解析（若可从当前环境解析到）
  try {
    const r = createRequire(join(process.cwd(), '__noop__.js'));
    const resolved = r.resolve('@deepseek-ai/dsh-host-apiproxy');
    const pkgRoot = resolved.slice(0, resolved.lastIndexOf('lib'));
    roots.add(dirname(pkgRoot));
    roots.add(dirname(dirname(pkgRoot)));
  } catch (_) {}

  // 常见位置：npx 缓存、全局 npm、~/.dsh
  const home = homedir();
  const npmCache = process.env.npm_config_cache || join(home, 'AppData', 'Local', 'npm-cache');
  roots.add(join(npmCache, '_npx'));
  if (process.platform === 'win32') {
    roots.add(join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'node_modules'));
    roots.add(join(home, '.dsh'));
  } else {
    roots.add('/usr/local/lib/node_modules');
    roots.add('/usr/lib/node_modules');
    roots.add(join(home, '.dsh'));
  }
  return roots;
}

/** 从候选根目录展开实际可能存在的 apiproxy 文件路径。 */
function candidateFiles(roots) {
  const files = new Set();
  for (const root of roots) {
    files.add(join(root, 'node_modules', APIPROXY_REL));
    files.add(join(root, APIPROXY_REL));
    if (root.endsWith('_npx')) {
      try {
        for (const dir of readdirSync(root, { withFileTypes: true })) {
          if (dir.isDirectory()) files.add(join(root, dir.name, 'node_modules', APIPROXY_REL));
        }
      } catch (_) {}
    }
  }
  return files;
}

let patched = 0;
const seen = new Set();
for (const file of candidateFiles(candidateRoots())) {
  if (seen.has(file) || !existsSync(file)) continue;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  const marker = `"${TARGET_NS}"`;
  if (source.includes(marker)) {
    console.log(`[skip] 已包含 ${TARGET_NS}: ${file}`);
    continue;
  }
  const pattern = /(const WEB_SETTINGS_NAMESPACES = \[(?:\r?\n\t"[^"]*",?)*\r?\n\t"web-search-deepseek",\r?\n)(\t*\];)/;
  const match = source.match(pattern);
  if (!match) {
    console.warn(`[warn] 找到文件但未匹配允许列表结构（DSH 版本可能不同）: ${file}`);
    continue;
  }
  const patchedSource = source.slice(0, match.index + match[1].length)
    + `\t"${TARGET_NS}"\n`
    + source.slice(match.index + match[1].length);
  if (!dryRun) writeFileSync(file, patchedSource, 'utf8');
  console.log(`[${dryRun ? 'dry' : 'ok'}] ${dryRun ? '将加入' : '已加入'} ${TARGET_NS}: ${file}`);
  patched++;
}

if (patched === 0) {
  console.log('\n[warn] 没有找到可打补丁的文件。请用显式参数指定 DSH 安装目录：');
  console.log('       node setup.mjs <DSH安装根目录>');
  console.log('       或手动编辑: <DSH安装>/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js');
  console.log('       在 WEB_SETTINGS_NAMESPACES 数组里加上 "' + TARGET_NS + '"');
} else if (!dryRun) {
  console.log(`\n完成：${patched} 个文件已打补丁。请重启 DSH（dsh web）使配置卡片生效。`);
}
