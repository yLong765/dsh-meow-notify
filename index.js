// meow-notify — DSH 全局通知插件（生产版 v8：host 端 + settings 集成）
//
// 双端结构（host 端本文件；client 端见 client.js，GUI 配置卡片）：
//   • host 端：注册 settings namespace「meow-notify」（GUI 卡片读写它），
//     并监听 session/event 推送：
//        - turn/end        -> DSH 任务完成
//        - approval/asked  -> DSH 需要介入（紧急，优先）
//   • 推送内容带「会话标识」：标题优先取会话标题(日志里的 session/title)，否则取工作目录名；
//     子代理会话加 [子] 前缀。便于多任务并行时分辨是哪个会话。
//
// 配置来源（三层合并：schema 默认值 ← cordis.patch.yml config（base）← settings.yaml（user，GUI 卡片写入））：
//   - nickname              MeoW 接收昵称（必填）
//   - base                  推送 API 根地址
//   - enabled               总开关
//   - turnEndMinIntervalMs  完成推送最小间隔（毫秒）
//   - includeChildren       是否通知子代理会话
//
// 客户端节流（应对 MeoW ~3/分钟静默限流：HTTP 仍回"发送成功"但实际不投递超量）：
//   • approval/asked：始终发送（人工必须介入），且不占用完成推送的节流额度。
//   • turn/end：距上一次完成推送不足 turnEndMinIntervalMs(默认 25s) 则跳过。
//   • includeChildren(false)：可关闭子代理会话的通知。
//
// v7：节流时间戳只由 turn/end 维护——approval/asked 不再占用完成推送的额度。
// v8：改为双端 npm 包：注册 settings namespace 供 GUI 卡片读写；LOG 跟随插件目录。
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { installSettingsSection } from '@deepseek-ai/dsh-settings';

const name = 'meow-notify';
const NS = 'meow-notify';
const LOG = join(dirname(fileURLToPath(import.meta.url)), 'notify.log');

/** Schemastery schema：GUI 卡片与 settings 域共用同一份字段定义。 */
const Config = z.object({
  enabled: z.boolean().default(true),
  nickname: z.string(),
  base: z.string().default('https://api.chuckfang.com'),
  turnEndMinIntervalMs: z.number().default(25000),
  includeChildren: z.boolean().default(true),
});

function filelog(line) {
  try { appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n', 'utf8'); }
  catch (_) {}
}

function clamp(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// 从会话对象提取人类可读标识（只读标量字段，不触碰内部 live 结构）
function describeSession(session) {
  let title, dir, isChild = false;
  try { isChild = !!(session && session.header && session.header.parentSession); } catch (_) {}
  try {
    const cwd = session && session.header && session.header.cwd;
    if (typeof cwd === 'string' && cwd.length) {
      const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
      dir = parts[parts.length - 1] || cwd;
    }
  } catch (_) {}
  try {
    const evs = session && session.events;
    if (Array.isArray(evs)) {
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i];
        if (e && e.type === 'session/title' && e.data && typeof e.data.title === 'string' && e.data.title.length) {
          title = e.data.title; break;
        }
      }
    }
  } catch (_) {}
  let label = clamp(title || dir || '?', 40);
  if (isChild) label = '[子] ' + label;
  return { title, dir, isChild, label };
}

function apply(ctx, config) {
  config = config || {};

  // settings 集成：把本插件的配置挂到 settings 域（base 层 = cordis.patch.yml 的 config，
  // user 层 = settings.yaml）。setSource 让推送逻辑实时读取合并后的配置；
  // 无 settings 服务时（headless 等 profile）回退到 config。
  let source = null;
  try {
    installSettingsSection(ctx, NS, Config, config, {
      setSource: (fn) => { source = fn; },
      onChange: () => {},
    });
  } catch (_) {}

  /** 合并后的生效配置：settings 域优先，回退到 patch config。 */
  function effective() {
    if (source) {
      try { const v = source(); if (v && typeof v === 'object') return v; } catch (_) {}
    }
    return config;
  }

  const log = function () {
    try {
      const a = Array.prototype.slice.call(arguments); a.unshift('[meow-notify]');
      const l = ctx.logger;
      if (l && typeof l.warn === 'function') l.warn.apply(l, a); else console.log.apply(console, a);
    } catch (_) {}
  };

  // 节流时间戳只由 turn/end 维护：approval/asked 永不节流，
  // 且不占用完成推送的节流额度（否则批准通知会把随后 25s 内的完成推送挤掉）。
  let lastTurnEndPushTs = 0;

  function push(headline, body, throttle) {
    const cfg = effective() || {};
    const nickname = cfg.nickname;
    const base = String(cfg.base || 'https://api.chuckfang.com').replace(/\/+$/, '');
    const turnEndMinIntervalMs = Number(cfg.turnEndMinIntervalMs ?? 25000);
    const now = Date.now();
    if (throttle && (now - lastTurnEndPushTs) < turnEndMinIntervalMs) {
      filelog('SKIP-THROTTLE [' + headline + '] gap=' + (now - lastTurnEndPushTs) + 'ms < ' + turnEndMinIntervalMs + 'ms');
      return;
    }
    if (throttle) lastTurnEndPushTs = now;
    let url;
    try {
      url = base + '/' + encodeURIComponent(nickname) + '/'
        + encodeURIComponent(clamp(headline, 40)) + '/' + encodeURIComponent(clamp(body, 80));
    } catch (e) { filelog('PUSH-ENCODE-FAIL'); return; }
    fetch(url, { method: 'GET' })
      .then(function (r) { return r.text(); })
      .then(function (t) { filelog('PUSH-OK [' + headline + '] ' + body + ' :: ' + t); })
      .catch(function (e) { const c = (e && e.cause && e.cause.code) || (e && e.message); filelog('PUSH-FAIL [' + headline + '] ' + c); });
  }

  ctx.on('session/event', function (session, event) {
    try {
      if (!event || typeof event.type !== 'string') return;
      const t = event.type;
      const d = describeSession(session);
      const cfg = effective() || {};
      const nickname = cfg.nickname;
      const enabled = cfg.enabled !== false;
      const base = String(cfg.base || 'https://api.chuckfang.com').replace(/\/+$/, '');
      const turnEndMinIntervalMs = Number(cfg.turnEndMinIntervalMs ?? 25000);
      const includeChildren = cfg.includeChildren !== false;
      if (!enabled || !nickname) { filelog('NOT-ENABLED'); return; }
      if (d.isChild && !includeChildren) return; // 按需忽略子代理

      if (t === 'approval/asked') {
        const ed = event.data || {};
        const tool = ed.toolName || '某项操作';
        const body = tool + ' 等待批准' + (d.title ? ' · ' + (d.dir || '') : '');
        filelog('EVENT approval/asked tool=' + tool + ' label=' + d.label);
        push('⚠️ ' + d.label, body, false);
      } else if (t === 'turn/end') {
        const ed = event.data || {};
        let reason = 'done';
        try { if (ed.reason && ed.reason.kind) reason = ed.reason.kind; } catch (_) {}
        const body = '第 ' + (ed.turn == null ? '?' : ed.turn) + ' 轮 · ' + reason + (d.title ? ' · ' + (d.dir || '') : '');
        filelog('EVENT turn/end turn=' + (ed.turn == null ? '?' : ed.turn) + ' reason=' + reason + ' label=' + d.label);
        push('✅ ' + d.label, body, true);
      }
    } catch (e) { filelog('HANDLER-ERROR ' + (e && e.message)); }
  });

  const cfg = effective() || {};
  filelog('LOADED v8 nickname=' + (cfg.nickname || '(unset)') + ' base=' + (cfg.base || '') + ' interval=' + (cfg.turnEndMinIntervalMs ?? 25000) + 'ms includeChildren=' + (cfg.includeChildren !== false) + ' node=' + process.version);
  if (cfg.enabled !== false && cfg.nickname) push('meow-notify', '插件已加载 v8 · ' + cfg.nickname, false);
}

export { name, apply };
