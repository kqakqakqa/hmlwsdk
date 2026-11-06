import zlib from "zlib";

/**
 * 零依赖 zip 读写
 *
 * 为什么不用 jszip：hap 和 .app 的签名块要插在「数据区」和「中央目录」之间，
 * 摘要按 1 MB 分片算（见 sign/digest.js 的 zipContentDigest）。这套算法要求
 * 签名前后字节布局完全可控。jszip 输出时会自己决定 extra field、时间戳、
 * 压缩策略、条目顺序，任何一项变了，摘要就对不上、设备验签不过。
 *
 * 所以这里只实现 hap/.app 用到的那一小部分：
 *   - 读：按 central directory 遍历，stored(method 0) 和 deflate(method 8) 两种
 *   - 写：DOS 时间固定 0，文件名统一 UTF-8 标志位，条目顺序就是传入顺序
 */

/* CRC32 查表，Node 18 没有内置 zlib.crc32 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

/**
 * 按 central directory 读 zip
 * @param {Buffer} buf
 * @returns {Array<{name:string, content:Buffer, size:number, method:number}>}
 */
export function readZip(buf) {
  // 从尾部找 EOCD
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip: EOCD not found");

  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const out = [];
  let p = cdOffset;

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`corrupt central directory at offset ${p}`);

    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);

    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;

    const body = buf.subarray(dataStart, dataStart + compSize);
    const content = method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body);

    if (content.length !== rawSize) {
      throw new Error(`${name}: inflated size mismatch: ${content.length} != ${rawSize}`);
    }

    out.push({ name, content, size: rawSize, method });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

/* DOS 时间固定值，保证同样的输入产出同样的字节 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01

/**
 * 打包 zip
 * @param {Array<{name:string, content:Buffer}>} entries
 * @param {{ compress?: boolean }} [opts] compress=false 时用 stored，hap 里的 .bin 就是 stored
 * @returns {Buffer}
 */
export function writeZip(entries, opts = {}) {
  const compress = opts.compress === true;

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const raw = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content);

    const crc = crc32(raw);
    const body = compress ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const method = compress ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);        // extra len
    central.writeUInt16LE(0, 32);        // comment len
    central.writeUInt16LE(0, 34);        // disk start
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(0, 38);        // external attrs
    central.writeUInt32LE(offset, 42);   // local header offset

    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const localBuf = Buffer.concat(locals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}
