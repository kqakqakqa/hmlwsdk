import zlib from "zlib";

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
  if (eocd === -1) throw new Error("不是 zip：找不到 EOCD");

  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const out = [];
  let p = cdOffset;

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory 损坏，偏移 ${p}`);

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
      throw new Error(`${name} 解压后大小不符：${content.length} != ${rawSize}`);
    }

    out.push({ name, content, size: rawSize, method });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}
