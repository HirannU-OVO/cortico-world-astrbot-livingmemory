// src/webui/client.ts
var errText = (err) => err instanceof Error ? err.message : String(err);
function makeCard(ui, title, value, desc) {
  const card = ui.h("div", "lm-card");
  card.append(ui.h("div", "lm-card-title", title));
  const val = ui.h("div", "lm-card-value");
  if (typeof value === "string") val.textContent = value;
  else val.append(value);
  card.append(val);
  if (desc) card.append(ui.h("div", "lm-card-desc", desc));
  return card;
}
var bridgePanel = {
  mount(ctx) {
    const { ui, root } = ctx;
    const msg = ui.msgline();
    const container = ui.h("div", "lm-container");
    root.append(msg, container);
    const render = async () => {
      container.innerHTML = "";
      let s;
      try {
        s = await ctx.invoke("status");
      } catch (err) {
        msg.textContent = `\u8BFB\u53D6\u6865\u63A5\u72B6\u6001\u5931\u8D25\uFF1A${errText(err)}`;
        msg.classList.add("bad");
        return;
      }
      msg.textContent = "";
      const hero = ui.h("div", `lm-hero ${s.ok ? s.upstreamConnected ? "is-ok" : "is-warn" : "is-bad"}`);
      const heroLeft = ui.h("div", "lm-hero-main");
      const stateText = s.probing ? "\u6B63\u5728\u68C0\u6D4B\u2026" : s.ok ? s.upstreamConnected ? "\u6865\u63A5\u6B63\u5E38" : "\u6865\u63A5\u5DF2\u8FDE \xB7 \u8BB0\u5FC6\u5E93\u672A\u5C31\u7EEA" : "\u672A\u8FDE\u63A5";
      heroLeft.append(ui.h("div", "lm-hero-title", stateText));
      heroLeft.append(
        ui.h(
          "div",
          "lm-hero-sub",
          s.ok ? `\u6865\u63A5\u670D\u52A1 ${s.bridgeVersion || "\u5DF2\u8FDE\u901A"}\u3000\xB7\u3000\u4E0A\u6E38\u8BB0\u5FC6\u5E93 ${s.upstreamVersion || "\u672A\u77E5"}\u3000\xB7\u3000\u5DE5\u5177 ${s.toolsCount} \u4E2A` : s.error || `\u65E0\u6CD5\u8FDE\u63A5 ${s.bridgeUrl}`
        )
      );
      const heroPill = ui.pill(
        s.probing ? "\u68C0\u6D4B\u4E2D" : s.ok ? s.upstreamConnected ? "\u25CF \u5728\u7EBF" : "\u25CF \u534A\u53EF\u7528" : "\u25CB \u79BB\u7EBF",
        s.probing ? "plain" : s.ok ? s.upstreamConnected ? "on" : "plain" : "off"
      );
      hero.append(heroLeft, heroPill);
      container.append(hero);
      if (!s.ok && !s.probing) {
        const grid = ui.h("div", "lm-grid");
        grid.append(
          makeCard(ui, "\u2460\u3000AstrBot \u662F\u5426\u5728\u8DD1", "\u68C0\u67E5\u8FDB\u7A0B", "\u786E\u8BA4 AstrBot \u6B63\u5728\u8FD0\u884C\uFF0C\u4E14\u5DF2\u542F\u7528 astrbot_plugin_coopanion_livingmemory \u63D2\u4EF6\u3002"),
          makeCard(ui, "\u2461\u3000\u7AEF\u53E3\u662F\u5426\u4E00\u81F4", "\u9ED8\u8BA4 6198", `\u5F53\u524D\u6307\u5411 ${s.bridgeUrl}\uFF0C\u9700\u4E0E AstrBot \u4FA7\u914D\u7F6E\u4E00\u81F4\u3002`),
          makeCard(ui, "\u2462\u3000\u6821\u9A8C token \u662F\u5426\u5339\u914D", "\u4E24\u7AEF\u540C\u503C", "\u82E5 AstrBot \u4FA7\u8BBE\u7F6E\u4E86\u6821\u9A8C token\uFF0C\u8FD9\u91CC\u5FC5\u987B\u586B\u5B8C\u5168\u4E00\u81F4\u7684\u503C\u3002")
        );
        container.append(grid);
        return;
      }
      const modeGrid = ui.h("div", "lm-grid");
      modeGrid.append(
        makeCard(ui, "\u8FD0\u884C\u6A21\u5F0F", s.usageLabel || s.usageMode, s.usageMode === "local" ? "\u4E0D\u63A5\u4EFB\u4F55\u5E73\u53F0\uFF0C\u72EC\u7ACB\u4F1A\u8BDD" : "\u684C\u5BA0\u4E0E AstrBot \u5171\u7528"),
        makeCard(ui, "\u8BB0\u5FC6\u5171\u4EAB", s.shareLabel || s.shareMode, s.shareMode === "pet_only" ? "\u8BB0\u5FC6\u5E93\u9694\u79BB\uFF0C\u4E92\u4E0D\u53EF\u89C1" : "\u5171\u7528\u77E5\u8BC6\u56FE\u8C31\u4E0E\u8BB0\u5FC6\u5E93"),
        makeCard(ui, "\u5DE5\u5177\u9762", `${s.toolsCount} \u4E2A`, "\u7531\u6865\u7AEF manifest \u52A8\u6001\u4E0B\u53D1")
      );
      container.append(modeGrid);
      const capSection = ui.h("div", "lm-section");
      const capHead = ui.h("div", "lm-section-head");
      const allOk = s.capsTotal > 0 && s.capsDisabled === 0;
      capHead.append(
        ui.h("span", "lm-section-title", "\u4E0A\u6E38\u80FD\u529B"),
        ui.pill(
          s.capsTotal === 0 ? "\u65E0\u6570\u636E" : allOk ? `\u5168\u90E8\u5C31\u7EEA ${s.capsTotal}/${s.capsTotal}` : `${s.capsDisabled} \u9879\u964D\u7EA7`,
          s.capsTotal === 0 ? "plain" : allOk ? "on" : "off"
        )
      );
      capSection.append(capHead);
      if (s.capabilities.length) {
        const capGrid = ui.h("div", "lm-cap-grid");
        for (const c of s.capabilities) {
          const item = ui.h("div", `lm-cap ${c.enabled ? "is-on" : "is-off"}`);
          item.append(ui.h("span", "lm-cap-dot"), ui.h("span", "lm-cap-label", c.label));
          capGrid.append(item);
        }
        capSection.append(capGrid);
      } else {
        capSection.append(ui.h("div", "lm-empty", "\u6865\u7AEF\u672A\u4E0A\u62A5\u80FD\u529B\u6E05\u5355"));
      }
      container.append(capSection);
      const bindSection = ui.h("div", "lm-section");
      bindSection.append(ui.h("div", "lm-section-head", "") && ui.h("div", "lm-section-title", "\u7ED1\u5B9A\u4E0A\u4E0B\u6587"));
      const bindTable = ui.h("div", "lm-bind");
      const rows = [
        ["\u4F1A\u8BDD\u4F5C\u7528\u57DF", s.sessionId || "\u9ED8\u8BA4\u4F1A\u8BDD"],
        ["\u9ED8\u8BA4\u4EBA\u683C", s.defaultPersona || "\u672A\u6307\u5B9A"],
        ["\u684C\u5BA0\u4EBA\u683C", s.petPersona || "\u8DDF\u968F\u6865\u7AEF"]
      ];
      for (const [k, v] of rows) {
        const row = ui.h("div", "lm-bind-row");
        row.append(ui.h("span", "lm-bind-key", k), ui.h("span", "lm-bind-val", v));
        bindTable.append(row);
      }
      bindSection.append(bindTable);
      container.append(bindSection);
      if (s.warnings.length) {
        const warnSection = ui.h("div", "lm-section lm-warn");
        warnSection.append(ui.h("div", "lm-section-title", "\u26A0\uFE0F \u9700\u8981\u7559\u610F"));
        for (const w of s.warnings) {
          const line = ui.h("div", "lm-warn-row");
          line.append(ui.h("span", "lm-warn-kind", w.kind), ui.h("span", "lm-warn-text", w.text));
          warnSection.append(line);
        }
        container.append(warnSection);
      }
    };
    const refreshBtn = ui.h("button", "lm-refresh", "\u5237\u65B0");
    refreshBtn.addEventListener("click", () => void render(), { signal: ctx.signal });
    root.prepend(refreshBtn);
    void render();
  },
  unmount() {
  }
};
var bundle = {
  panels: {
    bridge: bridgePanel
  }
};
var client_default = bundle;
export {
  client_default as default
};
