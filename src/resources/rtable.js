/**
 * R.txt 解析
 *
 * 实测格式（apps/_empty/_empty/entry/build/intermediates/res/debug/normal/lite/R.txt）：
 *   media icon 0x1000001
 *   media icon_small 0x1000002
 *   string appName 0x1000000
 *
 * 每行：资源类型 资源名 十六进制编号
 */

/**
 * @param {string} text
 * @returns {Record<string, Record<string, number>>} 例如 { media: { icon: 16777217 }, string: { appName: 16777216 } }
 */
export function parseRTable(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^(\w+)\s+(\w+)\s+0x([0-9a-fA-F]+)$/);
    if (!m) continue;
    (out[m[1]] ??= {})[m[2]] = parseInt(m[3], 16);
  }
  return out;
}

/**
 * 把 config.json 里 "$media:icon" / "$string:appName" 这类引用换成数字编号
 *
 * 实测对应关系：
 *   abilities[].icon  = "$media:icon"    → iconId  = 0x1000001 = 16777217
 *   abilities[].label = "$string:appName" → labelId = 0x1000000 = 16777216
 */
export function fillResourceIds(config, rtable) {
  const abilities = config.module?.abilities ?? [];
  for (const ab of abilities) {
    if (typeof ab.icon === "string" && ab.icon.startsWith("$media:")) {
      const id = rtable.media?.[ab.icon.slice("$media:".length)];
      if (id !== undefined) ab.iconId = id;
    }
    if (typeof ab.label === "string" && ab.label.startsWith("$string:")) {
      const id = rtable.string?.[ab.label.slice("$string:".length)];
      if (id !== undefined) ab.labelId = id;
    }
  }
  return config;
}
