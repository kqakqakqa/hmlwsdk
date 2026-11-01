/**
 * .bin —— liteWearable 应用包的私有容器格式
 *
 * 布局（未签名）：
 *   magic            uint8
 *   bundleNameLen    int32BE
 *   bundleName       utf8
 *   entries[]        直到文件结尾
 *     fileNameLen    int32BE
 *     fileName       utf8
 *     relPathLen     int32BE
 *     relPath        utf8
 *     contentLen     uint64BE
 *     content        raw
 *
 * 签名后的 .bin 在结尾追加签名块，最后 32 字节的倒数第 12~32 位是
 * ASCII "hw signed app   1000"。这是从 hmlw.pages.dev/tools 里
 * getHapInfo.js / getHapSignTime.js 反推出来的既有事实。
 */

export const SIGN_HEAD_ASCII = "hw signed app   1000";

/**
 * 判断一个 buffer 是否是签名过的 .bin
 */
export function isSignedBin(buf) {
  if (buf.length < 32) return false;
  return buf.toString("ascii", buf.length - 32, buf.length - 12) === SIGN_HEAD_ASCII;
}

/**
 * 去掉尾部签名块，返回纯内容部分
 *
 * 签名块不只是最后 32 字节的 signHead —— signHead 第 20 字节起是 subBlockSize，
 * 表示「签名块总长」（实测样本 6588），真正的正文是 buf.length - subBlockSize。
 * 只砍 32 字节的话，proBlock / signBlock / p7b / CMS 会留在正文里，
 * readBin 会把它们当成条目读，直接越界。
 *
 * 实测（apps/_3rd/随机事件 的 entry-bin-debug-lite-signed.hap）：
 * 总长 6906662，subBlockSize 6588，剥完 6900074，与 Gradle 的 unsigned bin 等长。
 */
export function stripSignature(buf) {
  if (!isSignedBin(buf)) return buf;
  const subBlockSize = buf.readUInt32BE(buf.length - 12);
  if (subBlockSize <= 32 || subBlockSize > buf.length) return buf.subarray(0, buf.length - 32);
  return buf.subarray(0, buf.length - subBlockSize);
}

/**
 * 解析 .bin
 * @param {Buffer} buf
 * @returns {{magic:number, bundleName:string, entries:Array<{fileName:string, relPath:string, content:Buffer}>}}
 */
export function readBin(buf) {
  const raw = stripSignature(buf);

  let off = 0;

  const magic = raw[off];
  off += 1;

  const bundleNameLen = raw.readInt32BE(off);
  off += 4;

  const bundleName = raw.toString("utf8", off, off + bundleNameLen);
  off += bundleNameLen;

  const entries = [];

  while (off < raw.length) {
    const fileNameLen = raw.readInt32BE(off);
    off += 4;

    const fileName = raw.toString("utf8", off, off + fileNameLen);
    off += fileNameLen;

    const relPathLen = raw.readInt32BE(off);
    off += 4;

    const relPath = raw.toString("utf8", off, off + relPathLen);
    off += relPathLen;

    const contentLen = Number(raw.readBigUInt64BE(off));
    off += 8;

    const content = raw.subarray(off, off + contentLen);
    off += contentLen;

    entries.push({ fileName, relPath, content });
  }

  return { magic, bundleName, entries };
}

/**
 * 序列化为 .bin（未签名）
 *
 * 实测对照：4 个真实 .bin 解析后重建，SHA256 全部相同 ——
 * _empty(15 条目/110958 B)、atri-mdm(903 条目/10786572 B)、
 * 腕上词典 6.4.0(201 条目/9662763 B)、openCrab(112 条目/8893516 B)。
 *
 * @param {{magic?:number, bundleName:string, entries:Array<{fileName:string, relPath:string, content:Buffer}>}} model
 * @returns {Buffer}
 */
export function writeBin(model) {
  const magic = model.magic ?? 0xbe;
  const bundleName = Buffer.from(model.bundleName, "utf8");

  const parts = [];

  const head = Buffer.allocUnsafe(5);
  head[0] = magic;
  head.writeInt32BE(bundleName.length, 1);
  parts.push(head);
  parts.push(bundleName);

  for (const e of model.entries) {
    const fileName = Buffer.from(e.fileName, "utf8");
    const relPath = Buffer.from(e.relPath ?? "", "utf8");
    const content = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content);

    const nameLen = Buffer.allocUnsafe(4);
    nameLen.writeInt32BE(fileName.length, 0);
    parts.push(nameLen, fileName);

    const pathLen = Buffer.allocUnsafe(4);
    pathLen.writeInt32BE(relPath.length, 0);
    parts.push(pathLen, relPath);

    const sizeLen = Buffer.allocUnsafe(8);
    sizeLen.writeBigUInt64BE(BigInt(content.length), 0);
    parts.push(sizeLen, content);
  }

  return Buffer.concat(parts);
}
