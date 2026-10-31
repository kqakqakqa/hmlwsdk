import zlib from "zlib";

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
