// meow-notify — DSH 客户端（browser half）
//
// 注册「设置 → 插件 → 插件配置」里的 meow-notify 卡片：
//   • 读：settings namespace「meow-notify」的合并值（defaults ← patch config ← settings.yaml）
//   • 写：保存时写入 settings.yaml 的 user 层（base 层保持 patch config 不动）
//
// bundle 格式：window.__ModuleLoader__.load({ id, factory })，
// factory 的 require 只使用 web 前端的静态模块表（react 等）与 dsh.client.inject 注入的模块。
window.__ModuleLoader__.load({
  id: "meow-notify",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime");

    const NS = "meow-notify";
    const inject = ["slots", "locale", "connection", "remote", "settingsScope"];

    // ---- 表单字段规格 ----
    function numberField(field) {
      return {
        field,
        format: (value) => typeof value === "number" ? String(value) : "",
        parse: (text) => {
          const trimmed = text.trim();
          if (trimmed === "") return { kind: "clear" };
          const parsed = Number(trimmed);
          return Number.isFinite(parsed) ? { kind: "set", value: parsed } : void 0;
        }
      };
    }
    function textField(field) {
      return {
        field,
        format: (value) => typeof value === "string" ? value : "",
        parse: (text) => {
          const trimmed = text.trim();
          return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
        }
      };
    }
    function boolField(field) {
      return {
        field,
        format: (value) => typeof value === "boolean" ? value : false,
        parse: (text) => ({ kind: "set", value: text === "true" })
      };
    }

    // ---- 一个文本/数字字段的控件（复用 DSH 的 CSS 变量视觉语言）----
    function ValueField(props) {
      return react_jsx_runtime.jsxs("div", {
        style: { display: "flex", flexDirection: "column", gap: 4 },
        children: [
          react_jsx_runtime.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8 },
            children: [
              react_jsx_runtime.jsx("label", {
                htmlFor: props.id,
                style: { fontSize: 13, color: "var(--dsw-alias-label-primary)", fontWeight: 600 },
                children: props.label
              }),
              props.overridden ? react_jsx_runtime.jsx("span", {
                style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", background: "var(--dsw-alias-bg-module-platform)", borderRadius: 999, padding: "1px 8px" },
                children: props.overriddenLabel
              }) : null
            ]
          }),
          react_jsx_runtime.jsx("input", {
            id: props.id,
            type: "text",
            value: props.text,
            placeholder: props.placeholder ?? "",
            disabled: props.disabled,
            style: {
              border: "1px solid var(--dsw-alias-border-l2)",
              background: "var(--dsw-alias-bg-layer-1)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 13,
              color: "var(--dsw-alias-label-primary)",
              font: "inherit",
              outline: "none"
            },
            onChange: (event) => props.onEdit(event.target.value)
          }),
          react_jsx_runtime.jsx("p", {
            style: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 },
            children: props.hint
          })
        ]
      });
    }

    // ---- 布尔字段（开关行）----
    function BoolField(props) {
      return react_jsx_runtime.jsxs("div", {
        style: { display: "flex", flexDirection: "column", gap: 4 },
        children: [
          react_jsx_runtime.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8 },
            children: [
              react_jsx_runtime.jsx("input", {
                id: props.id,
                type: "checkbox",
                checked: props.text === "true",
                disabled: props.disabled,
                onChange: (event) => props.onEdit(event.target.checked ? "true" : "false")
              }),
              react_jsx_runtime.jsx("label", {
                htmlFor: props.id,
                style: { fontSize: 13, color: "var(--dsw-alias-label-primary)" },
                children: props.label
              }),
              props.overridden ? react_jsx_runtime.jsx("span", {
                style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", background: "var(--dsw-alias-bg-module-platform)", borderRadius: 999, padding: "1px 8px" },
                children: props.overriddenLabel
              }) : null
            ]
          }),
          react_jsx_runtime.jsx("p", {
            style: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 },
            children: props.hint
          })
        ]
      });
    }

    // ---- 表单控制器：暂存 → 保存（一次写入所有已暂存字段）----
    var CardForm = class {
      constructor(scope, specs) {
        this.scope = scope;
        this.specs = new Map(specs.map((spec) => [spec.field, spec]));
        this.staged = new Map();
        this.listeners = new Set();
        this.saving = false;
        this.failed = false;
        scope.subscribe(() => this.publish());
      }
      bind(project) {
        const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
        this.listeners.add(() => store.set(project()));
        return store;
      }
      shell() {
        const snapshot = this.scope.getSnapshot();
        const plan = this.plan();
        return {
          available: snapshot.status === "ready",
          writable: snapshot.writable,
          dirty: plan.length > 0,
          invalid: plan.some((item) => item.run === void 0),
          saving: this.saving,
          failed: this.failed
        };
      }
      field(field) {
        const staged = this.staged.get(field);
        const spec = this.specs.get(field);
        if (spec === void 0) return { text: "", overridden: false, invalid: false };
        if (staged === void 0) return {
          text: spec.format(this.sectionValue(field)),
          overridden: this.stored(field),
          invalid: false
        };
        const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
        return {
          text: staged.text,
          overridden: write?.kind === "set",
          invalid: write === void 0
        };
      }
      actions() {
        return {
          edit: (field, text) => { this.staged.set(field, { text, clear: false }); this.failed = false; this.publish(); },
          resetField: (field) => { this.staged.set(field, { text: this.specs.get(field).format(this.baseValue(field)), clear: true }); this.publish(); },
          save: () => this.save(),
          discard: () => { if (this.staged.size === 0 && !this.failed) return; this.staged.clear(); this.failed = false; this.publish(); }
        };
      }
      baseValue(field) {
        const snapshot = this.scope.getSnapshot();
        return snapshot.base?.[field];
      }
      sectionValue(field) {
        return this.scope.getSnapshot().value?.[field];
      }
      stored(field) {
        const snapshot = this.scope.getSnapshot();
        return snapshot.user?.[field] !== void 0;
      }
      async save() {
        const plan = this.plan();
        const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
        if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
        this.saving = true;
        this.failed = false;
        this.publish();
        let landed = true;
        for (const write of writes) landed = await write() && landed;
        if (landed) this.staged.clear();
        this.saving = false;
        this.failed = !landed;
        this.publish();
      }
      plan() {
        const plan = [];
        for (const [field, staged] of this.staged) {
          const spec = this.specs.get(field);
          if (spec === void 0) continue;
          if (staged.clear) {
            if (this.stored(field)) plan.push({ field, run: () => this.scope.unset(field).then(() => !this.stored(field)) });
            continue;
          }
          if (staged.text === spec.format(this.sectionValue(field))) continue;
          const write = spec.parse(staged.text);
          if (write === void 0) plan.push({ field, run: void 0 });
          else if (write.kind === "clear") plan.push({ field, run: () => this.scope.unset(field).then(() => !this.stored(field)) });
          else plan.push({ field, run: () => this.scope.set(field, write.value).then(() => this.stored(field)) });
        }
        return plan;
      }
      publish() {
        for (const listener of [...this.listeners]) listener();
      }
    };

    // ---- 卡片组件 ----
    function MeowNotifyCard(props) {
      const { t } = props;
      const [open, setOpen] = react.useState(false);
      const state = props.useMeowNotify((snapshot) => snapshot);
      if (!state.available) return null;
      const blocked = !state.dirty || state.invalid || state.saving;
      const field = (name) => state[name];
      return react_jsx_runtime.jsxs("li", {
        style: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", borderRadius: 12, listStyle: "none" },
        children: [
          react_jsx_runtime.jsx("button", {
            type: "button",
            "aria-expanded": open,
            onClick: () => setOpen(!open),
            style: { appearance: "none", width: "100%", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", background: "0 0", border: 0, borderRadius: 12, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" },
            children: [
              react_jsx_runtime.jsxs("span", {
                style: { flexDirection: "column", flex: 1, gap: 4, minWidth: 0, display: "flex" },
                children: [
                  react_jsx_runtime.jsx("span", { style: { color: "var(--dsw-alias-label-primary)", fontSize: 15, fontWeight: 600, lineHeight: 1.4 }, children: t("title") }),
                  react_jsx_runtime.jsx("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 13, lineHeight: 1.5 }, children: t("description") })
                ]
              }),
              state.dirty ? react_jsx_runtime.jsx("span", {
                style: { whiteSpace: "nowrap", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 500, lineHeight: 17 },
                children: t("unsaved")
              }) : null,
              react_jsx_runtime.jsx("span", { style: { color: "var(--dsw-alias-label-tertiary)", transform: open ? "rotate(180deg)" : void 0 }, children: "▾" })
            ]
          }),
          open ? react_jsx_runtime.jsxs("div", {
            style: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", padding: "12px 0 8px", display: "flex", flexDirection: "column", gap: 12 },
            children: [
              !state.writable ? react_jsx_runtime.jsx("p", { role: "status", style: { color: "var(--dsw-alias-label-tertiary)", margin: 0, fontSize: 12 }, children: t("readOnly") }) : null,
              react_jsx_runtime.jsx(ValueField, {
                id: "meow-notify-nickname",
                label: t("nickname"),
                hint: t("nicknameHint"),
                placeholder: t("nicknamePlaceholder"),
                overriddenLabel: t("overridden"),
                disabled: !state.writable,
                ...field("nickname"),
                onEdit: (text) => props.edit("nickname", text)
              }),
              react_jsx_runtime.jsx(ValueField, {
                id: "meow-notify-base",
                label: t("base"),
                hint: t("baseHint"),
                placeholder: "https://api.chuckfang.com",
                overriddenLabel: t("overridden"),
                disabled: !state.writable,
                ...field("base"),
                onEdit: (text) => props.edit("base", text)
              }),
              react_jsx_runtime.jsx(ValueField, {
                id: "meow-notify-interval",
                label: t("interval"),
                hint: t("intervalHint"),
                placeholder: "25000",
                overriddenLabel: t("overridden"),
                disabled: !state.writable,
                ...field("turnEndMinIntervalMs"),
                onEdit: (text) => props.edit("turnEndMinIntervalMs", text)
              }),
              react_jsx_runtime.jsx(BoolField, {
                id: "meow-notify-include-children",
                label: t("includeChildren"),
                hint: t("includeChildrenHint"),
                overriddenLabel: t("overridden"),
                disabled: !state.writable,
                ...field("includeChildren"),
                onEdit: (text) => props.edit("includeChildren", text)
              }),
              react_jsx_runtime.jsxs("div", {
                style: { borderTop: "1px solid var(--dsw-alias-border-l2)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "12px 0 4px" },
                children: [
                  state.failed ? react_jsx_runtime.jsx("p", { role: "status", style: { minWidth: 0, color: "var(--dsw-alias-label-error)", flex: 1, margin: 0, fontSize: 12, lineHeight: 1.5 }, children: t("saveFailed") }) : null,
                  react_jsx_runtime.jsx("button", {
                    type: "button",
                    disabled: !state.dirty || state.saving,
                    onClick: props.discard,
                    style: { appearance: "none", font: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-secondary)", background: "0 0", borderRadius: 8, padding: "5px 14px", fontSize: 13, lineHeight: 1.5 },
                    children: t("discard")
                  }),
                  react_jsx_runtime.jsx("button", {
                    type: "button",
                    disabled: blocked,
                    onClick: props.save,
                    style: { appearance: "none", font: "inherit", cursor: "pointer", border: "1px solid transparent", color: "var(--dsw-alias-label-on-accent)", background: "var(--dsw-alias-state-business-primary)", borderRadius: 8, padding: "5px 14px", fontSize: 13, lineHeight: 1.5 },
                    children: t(state.saving ? "saving" : "save")
                  })
                ]
              })
            ]
          }) : null
        ]
      });
    }

    // ---- 控制器：把 settings scope 绑定到表单 ----
    var MeowNotifyCardController = class {
      constructor(scope) {
        this.form = new CardForm(scope, [
          textField("nickname"),
          textField("base"),
          numberField("turnEndMinIntervalMs"),
          boolField("includeChildren")
        ]);
        this.store = this.form.bind(() => this.projection());
      }
      projection() {
        return {
          ...this.form.shell(),
          nickname: this.form.field("nickname"),
          base: this.form.field("base"),
          turnEndMinIntervalMs: this.form.field("turnEndMinIntervalMs"),
          includeChildren: this.form.field("includeChildren")
        };
      }
      inject() {
        return {
          // hooks 键名会被渲染机制自动加 use 前缀（bindInjectHooks）：
          // meowNotify -> useMeowNotify，组件里用 props.useMeowNotify 读取。
          hooks: { meowNotify: this.store },
          ...this.form.actions()
        };
      }
    };

    // ---- 插件入口：注册设置卡片 ----
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, {
        zh: {
          title: "MeoW 推送",
          description: "任务完成与需要介入时推送到手机（MeoW App）。",
          nickname: "MeoW 昵称",
          nicknameHint: "MeoW App 里注册的接收昵称，必填；推送发给这个名字对应的设备。",
          nicknamePlaceholder: "例如 1529e2a0",
          base: "推送 API 地址",
          baseHint: "一般保持默认。换用其他推送渠道（如 Server酱、Bark）时改这里。",
          interval: "完成推送最小间隔（毫秒）",
          intervalHint: "两条任务完成推送的间隔不足此值时，后一条被跳过（防 MeoW 限流）。留空恢复默认 25000。",
          includeChildren: "通知子代理会话",
          includeChildrenHint: "关闭后，子代理/工作流会话完成与介入不再推送（标题带 [子] 前缀的）。",
          readOnly: "本部署的设置不可写。",
          overridden: "已覆盖",
          unsaved: "未保存",
          save: "保存",
          saving: "保存中…",
          discard: "放弃修改",
          saveFailed: "本部署没有接受这些值，已保留供你修改。"
        },
        en: {
          title: "MeoW push",
          description: "Push to your phone when a turn ends or approval is needed (MeoW App).",
          nickname: "MeoW nickname",
          nicknameHint: "The receiving nickname registered in the MeoW app; required. Pushes go to the device bound to this name.",
          nicknamePlaceholder: "e.g. 1529e2a0",
          base: "Push API base URL",
          baseHint: "Keep the default. Change only when switching to another channel (e.g. ServerChan, Bark).",
          interval: "Min interval between completion pushes (ms)",
          intervalHint: "A completion push closer than this to the previous one is skipped (MeoW rate limit guard). Leave blank for the 25000 default.",
          includeChildren: "Notify subagent sessions",
          includeChildrenHint: "When off, subagent/workflow sessions never push (their titles carry the [sub] prefix).",
          readOnly: "Settings are read-only in this deployment.",
          overridden: "Overridden",
          unsaved: "Unsaved",
          save: "Save",
          saving: "Saving…",
          discard: "Discard",
          saveFailed: "The deployment did not accept these values; they were left for you to correct."
        }
      }), "meow-notify: locales");
      const controller = new MeowNotifyCardController(ctx.settingsScope.bind({ namespace: NS }));
      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        id: "meow-notify",
        order: 30,
        locale: NS,
        inject: () => controller.inject()
      }, MeowNotifyCard));
      return controller;
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
