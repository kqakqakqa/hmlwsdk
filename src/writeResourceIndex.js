/**
 * 写 resources.index
 *
 * 这是 restool 自己的私有格式，不是 Android 的 resources.arsc。api6 的 1.022 用的是
 * 老版布局（源码里叫 IndexHeader，新版 restool 已经换成 IndexHeaderV2 了），结构：
 *
 *   0    128 字节  版本串 "Restool 1.022"，后面补 0
 *   128  u32       整个文件长度
 *   132  u32       配置组数（resources 下有几个限定目录，base 算一个）
 *
 *   然后每组一个 KEYS 块：
 *        "KEYS" + u32 本组 IDSS 块的绝对偏移 + u32 限定项个数
 *        + 每项 (i32 keyType, u32 value) 8 字节
 *
 *   然后每组一个 IDSS 块：
 *        "IDSS" + u32 本组 id 个数 + 每项 (u32 id, u32 记录绝对偏移)
 *
 *   最后是记录区，按配置组顺序、组内按 id 升序：
 *        u32 记录长度（不含自身 4 字节）+ i32 资源类型 + u32 id + 数据
 *
 * 数据那段是 ComposeStrings 拼出来的，见 parseElementJson.js 的注释。
 *
 * 实测对照（apps/_empty/_empty .../res/debug/normal/lite/resources.index，337 B）：
 *   0x00  "Restool 1.022" + 补 0 到 0x80
 *   0x80  0x151 = 337
 *   0x84  1
 *   0x88  "KEYS" 0x94(=148, 指向下面的 IDSS) 0（base 没有限定项）
 *   0x94  "IDSS" 3
 *   0x9C  (0x01000000, 180) (0x01000001, 211) (0x01000002, 268)
 *   0xB4  记录区，三条记录分别 31 / 57 / 69 字节
 * 本模块产出与该文件逐字节一致（SHA256 08F3CD66…）。
 */

/** 版本串。restool 把 RESTOOL_NAME + RESTOOL_VERSION 原样抄进这 128 字节，我们照样写，
 *  这样整个文件的 SHA256 才能和 Gradle 产物对上 */
const VERSION_TEXT = "Restool 1.022";

/** 版本串占用的固定空间 */
const VERSION_LEN = 128;

/**
 * @param {Array<{keyParams:Array<{keyType:number,value:number}>,
 *                items:Array<{id:number,resType:number,data:Buffer}>}>} configs
 *        顺序即写入顺序；items 必须已经按 id 升序排好
 * @returns {Buffer}
 */
export function writeResourceIndex(configs) {
  // 先把各块算出来，因为 KEYS 里的 offset 和 IDSS 里的 offset 都是文件绝对偏移，
  // 必须先知道前面所有块的长度才能填
  const keysBlocks = configs.map((config) => {
    const params = Buffer.alloc(config.keyParams.length * 8);
    config.keyParams.forEach((param, i) => {
      params.writeInt32LE(param.keyType, i * 8);
      params.writeUInt32LE(param.value, i * 8 + 4);
    });
    return params;
  });

  const keysAreaSize = configs.reduce((sum, _, i) => sum + 12 + keysBlocks[i].length, 0);
  const idssAreaSize = configs.reduce((sum, config) => sum + 8 + config.items.length * 8, 0);

  const idssStart = VERSION_LEN + 8 + keysAreaSize;
  const recordsStart = idssStart + idssAreaSize;

  // 记录区：先算出每条记录的偏移，IDSS 要用
  const recordBufs = [];
  const recordOffsets = configs.map(() => []);
  let cursor = recordsStart;
  for (const config of configs) {
    for (const item of config.items) {
      const record = Buffer.alloc(12 + item.data.length);
      // size 不含自身这 4 字节，所以是 8 + data
      record.writeUInt32LE(8 + item.data.length, 0);
      record.writeInt32LE(item.resType, 4);
      record.writeUInt32LE(item.id, 8);
      item.data.copy(record, 12);
      recordBufs.push(record);
      recordOffsets[configs.indexOf(config)].push(cursor);
      cursor += record.length;
    }
  }

  const totalSize = cursor;

  const header = Buffer.alloc(VERSION_LEN + 8);
  header.write(VERSION_TEXT, 0, "latin1");
  header.writeUInt32LE(totalSize, VERSION_LEN);
  header.writeUInt32LE(configs.length, VERSION_LEN + 4);

  // KEYS 区
  const keysArea = Buffer.alloc(keysAreaSize);
  let p = 0;
  let idssOffset = idssStart;
  configs.forEach((config, i) => {
    keysArea.write("KEYS", p, "latin1");
    keysArea.writeUInt32LE(idssOffset, p + 4);
    keysArea.writeUInt32LE(config.keyParams.length, p + 8);
    keysBlocks[i].copy(keysArea, p + 12);
    p += 12 + keysBlocks[i].length;
    idssOffset += 8 + config.items.length * 8;
  });

  // IDSS 区
  const idssArea = Buffer.alloc(idssAreaSize);
  p = 0;
  configs.forEach((config, i) => {
    idssArea.write("IDSS", p, "latin1");
    idssArea.writeUInt32LE(config.items.length, p + 4);
    p += 8;
    config.items.forEach((item, j) => {
      idssArea.writeUInt32LE(item.id, p);
      idssArea.writeUInt32LE(recordOffsets[i][j], p + 4);
      p += 8;
    });
  });

  return Buffer.concat([header, keysArea, idssArea, ...recordBufs]);
}
