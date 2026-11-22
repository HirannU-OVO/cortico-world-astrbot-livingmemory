/**
 * LivingMemory 桥接状态 WebUI 客户端 Bundle
 * 独立「桥接状态」页，与配置页分离；遵照 WebUiClientBundle 标准。
 */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import './style.css';

interface CapabilityItem {
  label: string;
  enabled: boolean;
}

interface StatusData {
  ok: boolean;
  probing: boolean;
  error: string;
  bridgeUrl: string;
  bridgeVersion: string;
  upstreamVersion: string;
  upstreamConnected: boolean;
  usageMode: string;
  usageLabel: string;
  shareMode: string;
  shareLabel: string;
  sessionId: string;
  defaultPersona: string;
  petPersona: string;
  capabilities: CapabilityItem[];
  capsTotal: number;
  capsDisabled: number;
  warnings: Array<{ kind: string; text: string }>;
  toolsCount: number;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 一格状态：标题 / 主值 / 副说明。 */
function makeCard(
  ui: WebUiPanelContext['ui'],
  title: string,
  value: HTMLElement | string,
  desc?: string,
): HTMLElement {
  const card = ui.h('div', 'lm-card');
  card.append(ui.h('div', 'lm-card-title', title));
  const val = ui.h('div', 'lm-card-value');
  if (typeof value === 'string') val.textContent = value;
  else val.append(value);
  card.append(val);
  if (desc) card.append(ui.h('div', 'lm-card-desc', desc));
  return card;
}

const bridgePanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui, root } = ctx;
    const msg = ui.msgline();
    const container = ui.h('div', 'lm-container');
    root.append(msg, container);

    const render = async () => {
      container.innerHTML = '';

      let s: StatusData;
      try {
        s = await ctx.invoke<StatusData>('status');
      } catch (err) {
        msg.textContent = `读取桥接状态失败：${errText(err)}`;
        msg.classList.add('bad');
        return;
      }
      msg.textContent = '';

      // ---------- 顶部：总体状态 ----------
      const hero = ui.h('div', `lm-hero ${s.ok ? (s.upstreamConnected ? 'is-ok' : 'is-warn') : 'is-bad'}`);
      const heroLeft = ui.h('div', 'lm-hero-main');
      const stateText = s.probing ? '正在检测…' : s.ok ? (s.upstreamConnected ? '桥接正常' : '桥接已连 · 记忆库未就绪') : '未连接';
      heroLeft.append(ui.h('div', 'lm-hero-title', stateText));
      heroLeft.append(
        ui.h(
          'div',
          'lm-hero-sub',
          s.ok
            ? `桥接服务 ${s.bridgeVersion || '已连通'}　·　上游记忆库 ${s.upstreamVersion || '未知'}　·　工具 ${s.toolsCount} 个`
            : (s.error || `无法连接 ${s.bridgeUrl}`),
        ),
      );
      const heroPill = ui.pill(
        s.probing ? '检测中' : s.ok ? (s.upstreamConnected ? '● 在线' : '● 半可用') : '○ 离线',
        s.probing ? 'plain' : s.ok ? (s.upstreamConnected ? 'on' : 'plain') : 'off',
      );
      hero.append(heroLeft, heroPill);
      container.append(hero);

      if (!s.ok && !s.probing) {
        // 未连接：给排查步骤，每条一格
        const grid = ui.h('div', 'lm-grid');
        grid.append(
          makeCard(ui, '①　AstrBot 是否在跑', '检查进程', '确认 AstrBot 正在运行，且已启用 astrbot_plugin_coopanion_livingmemory 插件。'),
          makeCard(ui, '②　端口是否一致', '默认 6198', `当前指向 ${s.bridgeUrl}，需与 AstrBot 侧配置一致。`),
          makeCard(ui, '③　校验 token 是否匹配', '两端同值', '若 AstrBot 侧设置了校验 token，这里必须填完全一致的值。'),
        );
        container.append(grid);
        return;
      }

      // ---------- 运行模式与共享 ----------
      const modeGrid = ui.h('div', 'lm-grid');
      modeGrid.append(
        makeCard(ui, '运行模式', s.usageLabel || s.usageMode, s.usageMode === 'local' ? '不接任何平台，独立会话' : '桌宠与 AstrBot 共用'),
        makeCard(ui, '记忆共享', s.shareLabel || s.shareMode, s.shareMode === 'pet_only' ? '记忆库隔离，互不可见' : '共用知识图谱与记忆库'),
        makeCard(ui, '工具面', `${s.toolsCount} 个`, '由桥端 manifest 动态下发'),
      );
      container.append(modeGrid);

      // ---------- 上游能力 ----------
      const capSection = ui.h('div', 'lm-section');
      const capHead = ui.h('div', 'lm-section-head');
      const allOk = s.capsTotal > 0 && s.capsDisabled === 0;
      capHead.append(
        ui.h('span', 'lm-section-title', '上游能力'),
        ui.pill(
          s.capsTotal === 0 ? '无数据' : allOk ? `全部就绪 ${s.capsTotal}/${s.capsTotal}` : `${s.capsDisabled} 项降级`,
          s.capsTotal === 0 ? 'plain' : allOk ? 'on' : 'off',
        ),
      );
      capSection.append(capHead);

      if (s.capabilities.length) {
        const capGrid = ui.h('div', 'lm-cap-grid');
        for (const c of s.capabilities) {
          const item = ui.h('div', `lm-cap ${c.enabled ? 'is-on' : 'is-off'}`);
          item.append(ui.h('span', 'lm-cap-dot'), ui.h('span', 'lm-cap-label', c.label));
          capGrid.append(item);
        }
        capSection.append(capGrid);
      } else {
        capSection.append(ui.h('div', 'lm-empty', '桥端未上报能力清单'));
      }
      container.append(capSection);

      // ---------- 绑定上下文 ----------
      const bindSection = ui.h('div', 'lm-section');
      bindSection.append(ui.h('div', 'lm-section-head', '') && ui.h('div', 'lm-section-title', '绑定上下文'));
      const bindTable = ui.h('div', 'lm-bind');
      const rows: Array<[string, string]> = [
        ['会话作用域', s.sessionId || '默认会话'],
        ['默认人格', s.defaultPersona || '未指定'],
        ['桌宠人格', s.petPersona || '跟随桥端'],
      ];
      for (const [k, v] of rows) {
        const row = ui.h('div', 'lm-bind-row');
        row.append(ui.h('span', 'lm-bind-key', k), ui.h('span', 'lm-bind-val', v));
        bindTable.append(row);
      }
      bindSection.append(bindTable);
      container.append(bindSection);

      // ---------- 警告 ----------
      if (s.warnings.length) {
        const warnSection = ui.h('div', 'lm-section lm-warn');
        warnSection.append(ui.h('div', 'lm-section-title', '⚠️ 需要留意'));
        for (const w of s.warnings) {
          const line = ui.h('div', 'lm-warn-row');
          line.append(ui.h('span', 'lm-warn-kind', w.kind), ui.h('span', 'lm-warn-text', w.text));
          warnSection.append(line);
        }
        container.append(warnSection);
      }
    };

    const refreshBtn = ui.h('button', 'lm-refresh', '刷新');
    refreshBtn.addEventListener('click', () => void render(), { signal: ctx.signal });
    root.prepend(refreshBtn);

    void render();
  },
  unmount() {},
};

const bundle: WebUiClientBundle = {
  panels: {
    bridge: bridgePanel,
  },
};

export default bundle;
