/**
 * 把 AstrBot 的 UMO 转成桥接认识的会话 id：
 *   aiocqhttp:GroupMessage:123456789 -> <persona>:GroupMessage:123456789
 * 解析失败返回 null，调用方负责跳过，绝不回落默认会话。
 */

export function resolveSessionFromUmo(
  umo: string | null | undefined,
  persona: string,
): string | null {
  const raw = String(umo ?? '').trim();
  const who = String(persona ?? '').trim();
  if (!raw || !who) return null;
  const parts = raw.split(':');
  if (parts.length !== 3) return null;
  const kind = parts[1];
  const id = parts[2].trim();
  if (kind !== 'GroupMessage' && kind !== 'FriendMessage') return null;
  if (!id) return null;
  return `${who}:${kind}:${id}`;
}

/** umo 优先；没有 umo 才使用显式配置；都拿不到返回 null。 */
export function pickSession(
  explicitConfigSession: string,
  umo: string | null | undefined,
  persona: string,
): string | null {
  const fromUmo = resolveSessionFromUmo(umo, persona);
  if (fromUmo) return fromUmo;
  return String(explicitConfigSession ?? '').trim() || null;
}

/** 面板中文值 / 旧英文值统一成桥接协议值。 */
export function normalizeMemoryMode(value: string | null | undefined): 'shared' | 'pet_only' {
  const raw = String(value ?? '').trim();
  if (raw === '桌宠单独一份' || raw.toLowerCase() === 'pet_only') return 'pet_only';
  return 'shared';
}

/** 按“配置里有没有这个键”决定是否沿用旧桥 pet_only。 */
export function resolveMemoryMode(
  hasMemoryModeKey: boolean,
  selected: string | null | undefined,
  bridgeMode: string | null | undefined,
): 'shared' | 'pet_only' {
  const configured = normalizeMemoryMode(selected);
  if (!hasMemoryModeKey && configured === 'shared' && bridgeMode === 'pet_only') {
    return 'pet_only';
  }
  return configured;
}
