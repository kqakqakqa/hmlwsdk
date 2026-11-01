import fs from "fs";
import path from "path";

/**
 * 把 element 目录下的 JSON 编译成 resources.index 里的一条条记录数据
 *
 * 这个文件负责「JSON 里的东西怎么变成那串字节」。格式全部来自 restool 源码
 * （json_compiler.cpp + resource_util.cpp 的 ComposeStrings），并用 probe 工程
 * 跑出来的真实产物逐字节核对过。
 *
 * 记录里 data 的布局是 ComposeStrings([value, name], true)：
 *
 *   u16 (value 长度 + 1)  value字节  \0   u16 (name 长度 + 1)  name字节  \0
 *
 * 数组类资源（intarray / strarray / plural / theme / pattern）多一层：内层先把
 * 每个元素各包成 "u16 长度 + 字节 + \0"（这时长度字段**不含** \0），再把整串
 * 当成一个值套用上面那层。所以数组的 value 段结尾会出现连续两个 \0。
 *
 * 实测对照（probe 工程 out-z/resources.index）：
 *   integer  aa_int = -7        value 段 = "-7\0"                    valueLen=3
 *   boolean  aa_bool = true     value 段 = "true\0"                  valueLen=5
 *   color    aa_color           value 段 = "#80FF00FF\0"             valueLen=10
 *   intarray aa_intarray=[1,2,3] value 段 = 01 00 "1" 00 01 00 "2" 00 01 00 "3" 00 00  valueLen=13
 *   strarray aa_strarray        value 段 = 01 00 "x" 00 01 00 "y" 00 00             valueLen=9
 *   plural   aa_plural          value 段 = 03 00 "one" 00 06 00 "一个" 00 ...        valueLen=33
 *   theme    aa_theme           value 段 = 02 00 "t1" 00 04 00 "#fff" 00 00         valueLen=13
 */

/** element 下 JSON 根键 → ResType。数值与 restool 的枚举一致，device 端按这个值查表 */
export const ELEMENT_TYPES = {
  element: 0,
  integer: 8,
  string: 9,
  strarray: 10,
  intarray: 11,
  boolean: 12,
  color: 14,
  id: 15,
  theme: 16,
  plural: 17,
  float: 18,
  pattern: 22,
  symbol: 23
};

/**
 * api6 的 restool 1.022 实际不接受的类型
 * 实测：symbol.json 报 "Json tag symbol is invalid"；id.json 报 "ParseJsonNodeByType unsupport ResType15"
 * （id 资源要走 base/element/id_defined.json，不是普通 JSON）
 */
const UNSUPPORTED_BY_API6 = new Set(["symbol", "id"]);

/** restool 会直接跳过、不当资源解析的文件 */
const IGNORED_FILE_NAMES = new Set(["id_defined.json"]);

/**
 * 解析一个 element 下的 JSON 文件
 *
 * @param {string} filePath
 * @returns {Array<{resType:number, typeName:string, name:string, data:Buffer}>}
 */
export function parseElementJson(filePath) {
  const fileName = path.basename(filePath);
  if (IGNORED_FILE_NAMES.has(fileName)) return [];

  const root = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const keys = Object.keys(root);
  if (keys.length !== 1) {
    throw new Error(`${fileName} 的根节点必须只有一个资源类型键，实际有 ${keys.length} 个: ${keys.join(",")}`);
  }

  const typeName = keys[0];
  const resType = ELEMENT_TYPES[typeName];
  if (resType === undefined) {
    throw new Error(`${fileName} 的根节点 "${typeName}" 不是资源类型`);
  }
  if (UNSUPPORTED_BY_API6.has(typeName)) {
    throw new Error(`${typeName} 类型 api6 的 restool 不支持，本 SDK 也不支持（文件 ${fileName}）`);
  }

  const items = root[typeName];
  if (!Array.isArray(items)) {
    throw new Error(`${fileName} 里 ${typeName} 必须是数组`);
  }

  return items.map((item) => {
    const name = checkName(item.name, fileName);
    // 记录里的 data 是「值 + 名字」两段，这里一次拼好，写 index 时直接落字节
    return { resType, typeName, name, data: composeStrings([encodeValue(typeName, item, fileName, name), name], true) };
  });
}

function checkName(name, fileName) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${fileName} 里有资源缺 name`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${fileName} 里的资源名 "${name}" 含非法字符（只允许字母数字下划线，不能数字开头）`);
  }
  return name;
}

/**
 * 按类型把 JSON 里的 value 变成 ResourceItem 的「数据段」
 *
 * 注意这里**只到数据段为止**，资源名还没拼进去 —— 记录里真正的 data 是
 * composeStrings([数据段, 资源名], true)，由调用方（compileResources）拼。
 *
 * 单值类型的数据段就是文本本身；数组类型的数据段是内层 composeStrings 的结果，
 * 里面每个元素各带一个 u16 长度头，且这个长度**不含**结尾的 \0 —— 所以写进记录后
 * 数组类资源的 value 段结尾会出现连续两个 \0。
 */
function encodeValue(typeName, item, fileName, name) {
  const where = `${fileName} 的 ${name}`;

  switch (typeName) {
    case "string":
      return asString(item.value, where);

    case "color":
      // restool 只校验 #RRGGBB / #AARRGGBB 这类写法，不转数字，原样存文本
      if (typeof item.value !== "string" || !/^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(item.value)) {
        throw new Error(`${where} 的颜色值 "${item.value}" 不合法`);
      }
      return item.value;

    case "float":
      // 源码要求 float 的 value 是字符串，实测传 "1.5" / "-0.25" 都原样保留
      return asString(item.value, where);

    case "boolean":
      if (typeof item.value !== "boolean") throw new Error(`${where} 的 value 必须是 true/false`);
      return String(item.value);

    case "integer":
      if (typeof item.value !== "number" || !Number.isInteger(item.value)) {
        throw new Error(`${where} 的 value 必须是整数`);
      }
      return String(item.value);

    case "intarray":
      if (!Array.isArray(item.value)) throw new Error(`${where} 的 value 必须是数组`);
      return composeStrings(
        item.value.map((v) => {
          if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${where} 的数组元素必须是整数`);
          return String(v);
        }),
        false
      );

    case "strarray":
      if (!Array.isArray(item.value)) throw new Error(`${where} 的 value 必须是数组`);
      return composeStrings(
        item.value.map((v) => asString(v?.value, where)),
        false
      );

    case "plural": {
      if (!Array.isArray(item.value)) throw new Error(`${where} 的 value 必须是数组`);
      const quantities = new Set();
      const segments = [];
      for (const v of item.value) {
        const quantity = asString(v?.quantity, where);
        if (quantities.has(quantity)) throw new Error(`${where} 的 quantity "${quantity}" 重复`);
        quantities.add(quantity);
        // 每个数组项固定两段：先 quantity 再 value
        segments.push(quantity, asString(v?.value, where));
      }
      if (!quantities.has("other")) throw new Error(`${where} 缺少 quantity 为 other 的项（restool 强制要求）`);
      return composeStrings(segments, false);
    }

    case "theme":
    case "pattern": {
      if (!Array.isArray(item.value)) throw new Error(`${where} 的 value 必须是数组`);
      const segments = [];
      // parent 会作为第一段写进去，带 $ 前缀
      if (item.parent !== undefined) {
        const parent = asString(item.parent, where);
        segments.push(parent.startsWith("$") ? "$ohos:" + parent.slice(1) : parent);
      }
      for (const v of item.value) {
        segments.push(asString(v?.name, where), asString(v?.value, where));
      }
      return composeStrings(segments, false);
    }

    default:
      throw new Error(`${typeName} 类型还没有实现编码（${where}）`);
  }
}

function asString(value, where) {
  if (typeof value !== "string") throw new Error(`${where} 的 value 必须是字符串`);
  return value;
}

/**
 * ComposeStrings：每段写成「u16 长度 + 字节 + \0」
 *
 * addNull 只影响长度字段是否 +1，\0 无论如何都写 —— 这是 restool 的原样行为，
 * 数组类资源的双 \0 结尾就是它造成的，不是 bug。
 */
export function composeStrings(segments, addNull) {
  const parts = [];
  for (const segment of segments) {
    const buf = Buffer.isBuffer(segment) ? segment : Buffer.from(segment, "utf8");
    const head = Buffer.alloc(2);
    head.writeUInt16LE(buf.length + (addNull ? 1 : 0), 0);
    parts.push(head, buf, Buffer.from([0]));
  }
  return Buffer.concat(parts);
}
