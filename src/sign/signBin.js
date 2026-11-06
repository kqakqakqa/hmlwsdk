import { slicedSha256 } from "./computeDigest.js";
import { buildSignedData } from "./buildCms.js";
import { stripSignature, isSignedBin } from "../readWriteBin.js";

/**
 * 给 .bin 追加签名块
 *
 * 布局（照抄 hap-sign-utils/sign-app-to-hap.js 的 signBin()，实测样本逐字节对得上）：
 *
 *   unsignedBin
 *   + proBlock    8 B   02 00 | p7bLen(u16 BE) | unsignedBinLen+16 (u32 BE)
 *   + signBlock   8 B   00 00 | 0000          | proBlock+p7bLen   (u32 BE)
 *   + p7b 原文
 *   → 对上面整段按 4096 分片算 SHA256
 *   → 套 16 B 头（"1000" + size + 块数 + 记录类型/算法/长度）+ 32 B 摘要
 *   → CMS SignedData（内含上面的 48 字节）
 *   + signHead    32 B  "hw signed app   " + "1000" + subBlockSize(u32 BE) + 0x02
 *
 * subBlockSize = 签完的总长 - unsignedBin 长度。实测
 * apps/_3rd/随机事件 的 entry-bin-debug-lite-signed.hap 里那份 bin：
 * 总长 6906662，unsigned 6900074，subBlockSize 6588，正好是两者之差。
 *
 * 四个坑（都来自参考实现，别"优化"）：
 *   1. p7bLen 只有 uint16，超过 65535 会溢出，必须断言
 *   2. 分片 4096 是自定义算法，不是标准 SHA256
 *   3. 中间那 16 字节头的 type/tag/algId 是固定值 00 / 88 / 0006
 *   4. 私钥必须和 p7b 里的叶子证书配对，否则签出来设备不认
 *
 * @param {{unsignedBin:Buffer, p7b:Buffer, keyPem:string, certPems:string[], signTime:string}} opts
 * @returns {Buffer}
 */
export function signBin({ unsignedBin, p7b, keyPem, certPems, signTime }) {
  if (p7b.length > 0xffff) {
    throw new Error(`p7b is ${p7b.length} B, over the uint16 limit of proBlock (65535)`);
  }

  const unsigned = isSignedBin(unsignedBin) ? stripSignature(unsignedBin) : unsignedBin;

  const unsignedLen = unsigned.length;
  const proBlockOffset = unsignedLen + 16;
  const signBlockOffset = proBlockOffset + p7b.length;

  const proBlock = blockHead(0x02, 0x00, p7b.length, proBlockOffset);
  const signBlock = blockHead(0x00, 0x00, 0, signBlockOffset);

  const signed = Buffer.concat([unsigned, proBlock, signBlock, p7b]);
  const hashBlock = contentHashBlock(slicedSha256(signed));

  const cms = buildSignedData({ econtent: hashBlock, certPems, keyPem, signTime });
  const withCms = Buffer.concat([signed, cms]);

  // 参考实现写的是 `bytes2.length - unsignedBinLen + 32`，那个 32 就是 signHead 自己的长度。
  // 实测对照：样本总长 6906662，unsigned 6900074，subBlockSize 6588 = 差 + 32。
  return Buffer.concat([withCms, signHead(withCms.length - unsignedLen + 32)]);
}

/** 8 字节块头：type / tag / len(u16 BE) / offset(u32 BE) */
function blockHead(type, tag, len, offset) {
  const b = Buffer.alloc(8);
  b[0] = type;
  b[1] = tag;
  b.writeUInt16BE(len, 2);
  b.writeUInt32BE(offset, 4);
  return b;
}

/**
 * 16 B 头 + 摘要，对应反编译出来的 SignContentInfo.getByteContent()
 *
 *   "1000"        版本
 *   size(u16 BE)  8 + 40 = 48，也就是头 16 B 加摘要的长度
 *   blocks(u16)   1
 *   00 88         记录的类型和 tag（固定）
 *   0006          算法编号（固定）
 *   length(u32)   摘要长度
 *   摘要
 */
function contentHashBlock(hash) {
  const head = Buffer.from([0x31, 0x30, 0x30, 0x30, 0x00, 0x00, 0x00, 0x01, 0x00, 0x88, 0x00, 0x06, 0, 0, 0, 0]);
  head.writeUInt16BE(16 + hash.length, 4);
  head.writeUInt32BE(hash.length, 12);
  return Buffer.concat([head, hash]);
}

/** 32 B 签名尾：设备靠它判断"这个 bin 签过名" */
function signHead(subBlockSize) {
  const head = Buffer.alloc(32);
  head.write("hw signed app   ", 0, "ascii");
  head.write("1000", 16, "ascii");
  head.writeUInt32BE(subBlockSize, 20);
  head.writeUInt32BE(0x02, 24);
  return head;
}
