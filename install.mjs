#!/usr/bin/env node
// install.mjs — meow-notify 一键安装脚本
//
// 一条命令完成首次安装（也可用于重复安装/修复）：
//   1. 定位 DSH 安装位置（host-apiproxy 所在目录）
//   2. 复制插件文件到 $DSH_HOME/profiles/node_modules/meow-notify/
//   3. 打平台补丁（把 meow-notify 加入 WEB_SETTINGS_NAMESPACES）
//   4. 幂等注册 cordis.patch.yml（含 nickname 提示）
//
// 用法：
//   meow-notify install                # 交互式（询问 MeoW 昵称）
//   meow-notify install --nickname X   # 非交互
//   meow-notify install --dry-run      # 只演练不写入
//   meow-notify uninstall              # 卸载（移除 patch 条目 + 平台补丁，保留文件）
//
// 平台限制说明：DSH 0.1.0-rc.x 的 host-apiproxy 硬编码了 Web 设置允许列表
// WEB_SETTINGS_NAMESPACES，第三方插件的 settings namespace 必须加入该列表
// 才能被 GUI 配置卡片读写（官方注释称此为 "deferred work"）。本脚本自动完成。
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const TARGET_NS = 'meow-notify';
const APIPROXY_REL = join('@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js');
const PKG_NAME = 'meow-notify';
const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const nicknameArg = args.find((a) => a.startsWith('--nickname='))?.split('=')[1]
  ?? (() => { const i = args.indexOf('--nickname'); return i >= 0 ? args[i + 1] : undefined; })();
const action = args.find((a) => !a.startsWith('--')) ?? 'install';

/** 写入时若 dryRun 只打印。 */
function write(file, content) {
  if (dryRun) { console.log(`  [dry] 写入 ${file}`); return; }
  writeFileSync(file, content, 'utf8');
}
function ensureDir(dir) {
  if (!existsSync(dir)) { if (dryRun) console.log(`  [dry] 创建目录 ${dir}`); else mkdirSync(dir, { recursive: true }); }
}

/** 解析 $DSH_HOME（与 DSH 的 resolveDshHome 一致：环境变量优先，否则 ~/.dsh）。 */
function resolveDshHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim()) return env.trim();
  return join(homedir(), '.dsh');
}

/** 通过 require 从各候选目录解析 host-apiproxy 的真实加载路径。 */
function findApiproxy() {
  const requireFrom = (dir) => {
    try {
      const r = createRequire(join(dir, '__noop__.js'));
      return r.resolve('@deepseek-ai/dsh-host-apiproxy');
    } catch { return undefined; }
  };
  const dshHome = resolveDshHome();
  const envSet = !!(process.env.DSH_HOME && process.env.DSH_HOME.trim());
  // $DSH_HOME 显式设置时，DSH 安装可能在 home 下的 profiles/node_modules（flat fallback）
  const homeCandidates = [
    join(dshHome, 'profiles', 'node_modules'),
    dshHome,
    join(dshHome, 'profiles', 'web'),
    join(dshHome, 'profiles'),
  ];
  if (envSet) {
    for (const c of homeCandidates) {
      const resolved = requireFrom(c);
      if (resolved) return { apiproxy: resolved, root: c };
    }
  }
  // 全局回退：当前目录、npx 缓存（Windows: %LOCALAPPDATA%/npm-cache/_npx；macOS/Linux: ~/.npm/_npx）
  const npxCacheBase = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'npm-cache')
    : join(homedir(), '.npm');
  const globalCandidates = [process.cwd(), join(npxCacheBase, '_npx')];
  const expanded = [];
  for (const c of globalCandidates) {
    if (c.endsWith('_npx') && existsSync(c)) {
      for (const dir of readdirSync(c, { withFileTypes: true })) {
        if (dir.isDirectory()) expanded.push(join(c, dir.name, 'node_modules'));
      }
    } else expanded.push(c);
  }
  for (const c of expanded) {
    const resolved = requireFrom(c);
    if (resolved) return { apiproxy: resolved, root: c };
  }
  // 最后：默认 home 下也找一遍（DSH_HOME 未设置时 ~/.dsh 下的 profile 副本）
  if (!envSet) {
    for (const c of homeCandidates) {
      const resolved = requireFrom(c);
      if (resolved) return { apiproxy: resolved, root: c };
    }
  }
  return undefined;
}

/** 平台补丁：把 TARGET_NS 加入 WEB_SETTINGS_NAMESPACES。返回是否发生变化。 */
function patchApiproxy(apiproxyPath) {
  const source = readFileSync(apiproxyPath, 'utf8');
  const marker = `"${TARGET_NS}"`;
  if (source.includes(marker)) { console.log(`  [skip] 平台补丁已存在: ${apiproxyPath}`); return false; }
  const pattern = /(const WEB_SETTINGS_NAMESPACES = \[(?:\r?\n\t"[^"]*",?)*\r?\n\t"web-search-deepseek",\r?\n)(\t*\];)/;
  const match = source.match(pattern);
  if (!match) {
    console.error(`  [error] 未找到允许列表结构（DSH 版本可能不同），请手动修改: ${apiproxyPath}`);
    return false;
  }
  const patched = source.slice(0, match.index + match[1].length)
    + `\t"${TARGET_NS}"\n`
    + source.slice(match.index + match[1].length);
  write(apiproxyPath, patched);
  console.log(`  [ok] 平台补丁已加入 ${TARGET_NS}: ${apiproxyPath}`);
  return true;
}

/** 幂等地把 meow-notify 条目写进 $DSH_HOME/cordis.patch.yml。 */
function registerPatch(dshHome, nickname) {
  const patchFile = join(dshHome, 'cordis.patch.yml');
  // base 默认值与 index.js 的 Config schema 保持一致；改默认地址时两处同步。
  const DEFAULT_BASE = 'https://api.chuckfang.com';
  const entryBlock = `- insert:\n    - id: meow-notify\n      name: 'meow-notify'\n      config:\n        enabled: true\n        nickname: "${nickname}"\n        base: "${DEFAULT_BASE}"\n`;
  const header = `# DSH 全局补丁层：对所有 profile 生效，运行中修改会被热加载。\n`;
  if (!existsSync(patchFile)) {
    write(patchFile, header + entryBlock);
    console.log(`  [ok] 已创建并注册 ${patchFile}`);
    return true;
  }
  const content = readFileSync(patchFile, 'utf8');
  if (content.includes('id: meow-notify')) {
    console.log(`  [skip] patch 注册已存在: ${patchFile}`);
    return false;
  }
  // 处理「空数组」文件：把裸 [] 替换为条目（[] 后不能直接追加块序列，YAML 非法）。
  // 匹配可选的注释头 + 空数组（兼容 CRLF/LF、尾部空白）。
  const emptyArray = /^(\s*#.*\r?\n)*\s*\[\s*\]\s*$/;
  if (emptyArray.test(content.trimEnd())) {
    const commentPart = content.match(/^(#.*\r?\n)+/)?.[0] ?? header;
    write(patchFile, commentPart + entryBlock);
    console.log(`  [ok] 已注册到 ${patchFile}（替换空数组）`);
    return true;
  }
  const updated = content.trimEnd() + `\n${entryBlock}`;
  write(patchFile, updated);
  console.log(`  [ok] 已追加注册到 ${patchFile}`);
  return true;
}

/** 复制插件文件到 $DSH_HOME/profiles/node_modules/meow-notify/。 */
function deployFiles(dshHome) {
  const destDir = join(dshHome, 'profiles', 'node_modules', PKG_NAME);
  ensureDir(destDir);
  const files = ['index.js', 'client.js', 'package.json', 'README.md', 'install.mjs', 'setup.mjs', 'install.bat'];
  for (const f of files) {
    const src = join(HERE, f);
    if (!existsSync(src)) continue;
    if (dryRun) console.log(`  [dry] 复制 ${f} -> ${join(destDir, f)}`);
    else copyFileSync(src, join(destDir, f));
  }
  console.log(`  [ok] 插件文件已部署: ${destDir}`);
  return destDir;
}

/** 卸载：移除 patch 条目与平台补丁（保留文件）。 */
function uninstall(dshHome, apiproxyPath) {
  const patchFile = join(dshHome, 'cordis.patch.yml');
  if (existsSync(patchFile)) {
    const content = readFileSync(patchFile, 'utf8');
    // 移除从 "- insert:" 到包含 id: meow-notify 的整个块（含其后缩进的 config 行）
    // 兼容 CRLF 与 LF 行尾（Windows 编辑过的 YAML 常为 CRLF）
    const re = /- insert:\r?\n    - id: meow-notify\r?\n(?:    .*\r?\n)*/;
    const updated = content.replace(re, '');
    if (updated !== content) {
      // 删除后文件必须仍是合法的顶层 YAML 数组：若只剩注释/空白（解析为空文档），
      // 补一个空数组，否则 DSH 启动会报 "must be a top-level YAML array"。
      const trimmed = updated.trim();
      const validArray = /^(\s*#.*\r?\n)*\s*\[\s*\]\s*$/.test(trimmed) || trimmed.startsWith('-');
      write(patchFile, validArray ? updated : `${updated.trimEnd()}\n[]\n`);
      console.log(`  [ok] 已移除 patch 条目: ${patchFile}`);
    } else console.log(`  [skip] patch 无 meow-notify 条目`);
  }
  if (apiproxyPath && existsSync(apiproxyPath)) {
    const source = readFileSync(apiproxyPath, 'utf8');
    const updated = source.replace(`\t"${TARGET_NS}"\n`, '');
    if (updated !== source) {
      write(apiproxyPath, updated);
      console.log(`  [ok] 已移除平台补丁: ${apiproxyPath}`);
    } else console.log(`  [skip] 平台补丁不存在`);
  }
  console.log('\n完成。插件文件保留在 profiles/node_modules/meow-notify/，可手动删除。');
}

async function promptNickname() {
  if (nicknameArg) return nicknameArg;
  if (dryRun) return 'YOUR_NICKNAME';
  // 非交互 stdin（管道/自动化）时，尝试从已有 patch 配置继承昵称
  if (!process.stdin.isTTY) {
    try {
      const patchFile = join(resolveDshHome(), 'cordis.patch.yml');
      if (existsSync(patchFile)) {
        const m = readFileSync(patchFile, 'utf8').match(/nickname:\s*"([^"]+)"/);
        if (m) { console.log(`  [info] 复用已有昵称: ${m[1]}`); return m[1]; }
      }
    } catch (_) {}
    console.error('[error] 未提供昵称且无法从已有配置继承，请使用 --nickname 参数。');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('请输入 MeoW 接收昵称（MeoW App「我的」页面可见，必填）: ', resolve));
  rl.close();
  return answer.trim();
}

async function main() {
  console.log(`=== meow-notify ${dryRun ? '(演练模式)' : '安装'} ===`);
  const dshHome = resolveDshHome();
  console.log(`[1/4] DSH home: ${dshHome}`);

  const found = findApiproxy();
  if (!found) {
    console.error('[error] 未找到 DSH 安装（无法解析 @deepseek-ai/dsh-host-apiproxy）。');
    console.error('       请确认已运行过 dsh web，或设置 DSH_HOME 环境变量后重试。');
    process.exit(1);
  }
  console.log(`[2/4] DSH host-apiproxy: ${found.apiproxy}`);

  if (action === 'uninstall') {
    uninstall(dshHome, found.apiproxy);
    return;
  }

  const nickname = await promptNickname();
  if (!nickname) { console.error('[error] 昵称不能为空'); process.exit(1); }

  console.log('[3/4] 部署插件文件…');
  deployFiles(dshHome);

  console.log('[4/4] 打平台补丁 + 注册配置…');
  patchApiproxy(found.apiproxy);
  registerPatch(dshHome, nickname);

  console.log('\n=== 安装完成 ===');
  console.log('下一步：');
  console.log('  1. 重启 DSH：dsh web');
  console.log('  2. 手机应收到「插件已加载 v9 · 你的昵称」推送');
  console.log('  3. 浏览器打开设置 → 插件 → 插件配置，可看到「MeoW 推送」卡片');
  if (dryRun) console.log('\n（演练模式：未写入任何文件）');
}

main().catch((e) => { console.error('[error]', e.message); process.exit(1); });
