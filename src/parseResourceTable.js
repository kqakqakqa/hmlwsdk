/**
 * R.txt 解析 + config.json 里的资源引用回填
 *
 * 实测格式（apps/_empty/_empty/entry/build/intermediates/res/debug/normal/lite/R.txt）：
 *   media icon 0x1000001
 *   media icon_small 0x1000002
 *   string appName 0x1000000
 *
 * 每行：资源类型 资源名 十六进制编号。行尾带换行，最后一行也带。
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
 * config.json 里哪些字段是资源引用，以及引用应该指向哪个类型
 *
 * 来自 restool 源码 ConfigParser::JSON_STRING_IDS。restool 编译完资源后会遍历整份
 * config.json，碰到这些字段并且值是 "$类型:名字" 就在旁边补一个 "<字段>Id" 的数字，
 * 原字符串不动。
 *
 * 实测依据：
 *   apps/_inactive/stock 用 restool 跑一遍，abilities[0] 多出 iconId / labelId /
 *   descriptionId 三个字段，而 icon / label / description 三个字符串原样保留。
 */
const REF_FIELDS = new Map([
  ["icon", "media"],
  ["label", "string"],
  ["description", "string"],
  ["theme", "theme"],
  ["reason", "string"],
  ["startWindowIcon", "media"],
  ["startWindowBackground", "color"],
  ["fileContextMenu", "profile"],
  ["orientation", "string"]
]);

/**
 * 把 config.json 里 "$media:icon" / "$string:appName" 这类引用回填成数字 id
 *
 * 会在原对象上直接加 "<字段>Id"，并返回同一个对象。
 *
 * 实测对应关系：
 *   abilities[].icon        = "$media:icon"            → iconId        = 0x1000001
 *   abilities[].label       = "$string:appName"        → labelId       = 0x1000000
 *   abilities[].description = "$string:MainAbility_desc" → descriptionId = 0x1000000（stock）
 *
 * @param {object} config
 * @param {Record<string, Record<string, number>>} rtable parseRTable 的结果
 */
export function fillResourceIds(config, rtable) {
  walkNode(config, rtable);
  return config;
}

function walkNode(node, rtable) {
  if (Array.isArray(node)) {
    for (const item of node) walkNode(item, rtable);
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node)) {
    const expectedType = REF_FIELDS.get(key);
    if (expectedType !== undefined && typeof value === "string") {
      const match = value.match(/^\$([a-z]+):(.+)$/);
      if (match && match[1] === expectedType) {
        const id = rtable[expectedType]?.[match[2]];
        if (id !== undefined) node[key + "Id"] = id;
      }
    }
    walkNode(value, rtable);
  }
}
