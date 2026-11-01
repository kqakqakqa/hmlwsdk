import { zipContentDigest } from "./computeDigest.js";
import { buildSignedData } from "./buildCms.js";

/**
 * 给 zip（hap 或 .app）插签名块
 *
 * 两者用的是**完全相同**的块格式 —— 实测 `-mode localjks` 签出来的 .app 和
 * `-mode binlocaljks` 签出来的 hap，块头字段语义一模一样。
 *
 * 块插在「文件数据结束」和「中央目录」之间，EOCD 的 cdOffset 跟着往后挪：
 *
 *   块 = 头 24 B + p7b 原文 + CMS + 尾 32 B
 *
 *   头 24 B（5 个真实样本 + 1 个 jar 现签的 .app 全部对得上）：
 *     02 00            常量
 *     00 20            常量
 *     u32 LE           p7b 的 DER **总长**（含 4 B DER 头）
 *     18 00 00 00      常量 24（头长）
 *     00 00 00 20      常量
 *     u32 LE           CMS 总长
 *     u32 LE           24 + p7b 总长（CMS 在块内的偏移）
 *
 *   尾 32 B：
 *     u32 LE 2 / u32 LE 块长 / u32 LE 0 / "HAP Sig Block 42" / u32 LE 2
 *
 *   块长 = 24 + p7b 总长 + CMS 总长 + 32
 *
 * CMS 的 econtent 52 B，内容是「这 52 字节的 SHA256 被签在 CMS 里」：
 *   u32 LE 2 / u32 LE 1 / u32 LE 40 / u8 1 / u8 2 / u16 LE 0 / u32 LE 32 / 摘要
 *   （40 = 后面单块记录的长度 1+1+2+4+32）
 * 这几个整数字段是**小端** —— econtent 开头实测是 02 00 00 00，
 * 按大端读会变成 33554432，明显是 LE。
 *
 * 摘要算法见 digest.js 的 zipContentDigest。
 *
 * @param {{zipBuf:Buffer, p7b:Buffer, keyPem:string, certPems:string[], signTime:string}} opts
 * @returns {{zip:Buffer, blockLen:number, digest:Buffer}}
 */
export function signZip({ zipBuf, p7b, keyPem, certPems, signTime }) {
  const src = stripZipSignature(zipBuf);
  const { cdOffset, cdSize, eocdAt } = readZipLayout(src);

  const eocd = src.subarray(eocdAt);
  if (eocd.length !== 22 + eocd.readUInt16LE(20)) {
    throw new Error("EOCD 长度和 comment 长度对不上，这个 zip 可能被截断过");
  }

  const inputs = [src.subarray(0, cdOffset), src.subarray(cdOffset, cdOffset + cdSize), eocd];
  const digest = zipContentDigest(inputs, [p7b]);

  const econtent = Buffer.alloc(52);
  econtent.writeUInt32LE(2, 0);
  econtent.writeUInt32LE(1, 4);
  econtent.writeUInt32LE(40, 8);
  econtent[12] = 0x01;
  econtent[13] = 0x02;
  econtent.writeUInt16LE(0, 14);
  econtent.writeUInt32LE(32, 16);
  digest.copy(econtent, 20);

  const cms = buildSignedData({ econtent, certPems, keyPem, signTime });
  const blockLen = 24 + p7b.length + cms.length + 32;

  const head = Buffer.alloc(24);
  head.writeUInt16LE(2, 0);
  head.writeUInt16BE(0x0020, 2);
  head.writeUInt32LE(p7b.length, 4);
  head.writeUInt32LE(24, 8);
  head.writeUInt32BE(0x20, 12);
  head.writeUInt32LE(cms.length, 16);
  head.writeUInt32LE(24 + p7b.length, 20);

  const tail = Buffer.alloc(32);
  tail.writeUInt32LE(2, 0);
  tail.writeUInt32LE(blockLen, 4);
  tail.write("HAP Sig Block 42", 12, "ascii");
  tail.writeUInt32LE(2, 28);

  const block = Buffer.concat([head, p7b, cms, tail]);

  // EOCD 的 cdOffset 往后挪一个块长，其余字节原样
  const newEocd = Buffer.from(eocd);
  newEocd.writeUInt32LE(cdOffset + blockLen, 16);

  return {
    zip: Buffer.concat([src.subarray(0, cdOffset), block, src.subarray(cdOffset, eocdAt), newEocd]),
    blockLen,
    digest
  };
}

/**
 * 已签过的再签一次会把旧块留在里面，先剥掉
 * 判断依据：中央目录前 20 字节是 "HAP Sig Block 42"
 */
export function stripZipSignature(buf) {
  const at = buf.lastIndexOf("HAP Sig Block 42");
  if (at < 0) return buf;

  const { cdOffset } = readZipLayout(buf);
  if (at + 20 !== cdOffset) return buf;

  const blockLen = buf.readUInt32LE(at - 8);
  const dataEnd = cdOffset - blockLen;
  if (dataEnd < 0) return buf;

  const eocdAt = findEocd(buf);
  const eocd = Buffer.from(buf.subarray(eocdAt));
  eocd.writeUInt32LE(dataEnd, 16);
  return Buffer.concat([buf.subarray(0, dataEnd), buf.subarray(cdOffset, eocdAt), eocd]);
}

/** 从 EOCD 读中央目录的位置和大小 */
export function readZipLayout(buf) {
  const eocdAt = findEocd(buf);
  return {
    eocdAt,
    cdSize: buf.readUInt32LE(eocdAt + 12),
    cdOffset: buf.readUInt32LE(eocdAt + 16)
  };
}

/**
 * 从尾部往前找 EOCD，且要求「22 + comment 长度」正好到文件末尾
 * （只认签名不够 —— 中央目录里可能出现 50 4b 05 06 的巧合字节）
 */
function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x05 || buf[i + 3] !== 0x06) continue;
    if (i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new Error("找不到 EOCD，这不是一个完整的 zip");
}
