import crypto from "crypto";

/**
 * .bin 的签名摘要：按 4096 字节分片，每片算 SHA256，把摘要拼起来再算一次
 *
 * 出处：hap-sign-utils/sign-app-to-hap.js 的 slicedSHA256()，纯 JS 参考实现。
 * 4096 是自定义值，不是标准 SHA256 的分块大小，要与设备验签一致就得原样照抄。
 */
export function slicedSha256(buf, chunkSize = 4096) {
  const hashes = [];
  for (let i = 0; i < buf.length; i += chunkSize) {
    hashes.push(crypto.createHash("sha256").update(buf.subarray(i, i + chunkSize)).digest());
  }
  return crypto.createHash("sha256").update(Buffer.concat(hashes)).digest();
}

const ZIP_CHUNK = 1048576;

/**
 * zip（hap / app）的签名摘要：1 MB 分片，每片前面挂 5 字节
 *
 * 算法来自反编译 hapsigntoolv2.jar：
 *   HapUtils.CONTENT_DIGESTED_CHUNK_MAX_SIZE_BYTES = 1048576
 *   computeDigests()          —— 分片循环、5 字节前缀、hashBuf 布局
 *   initComputeItem()         —— hashBuf 前 5 字节写 0x5A 和片数
 *   getContentDigestAlgorithmMap() —— 末尾追加 signingBlocks 再 digest
 * 前缀的 0xA5 是 computeDigests 里 buffer[0] = -91 写死的。
 *
 * 三个数据段是分开的三个 input（反编译 SignProvider.sign 的字节码）：
 *   [0, 中央目录偏移) / [中央目录偏移, 中央目录末) / EOCD
 * 分片计数按各自长度分别向上取整，不能拼成一段。
 *
 * 实测：apps/_3rd 下 7 个 Gradle 产出的 signed hap，加上用 jar 现签的
 * signed .app，重算 econtent 里的 32 B 摘要全部命中。
 *
 * @param {Buffer[]} inputs 三段数据
 * @param {Buffer[]} blocks signingBlocks 的 value，签名时就是 p7b 原文
 * @returns {Buffer} 32 字节
 */
export function zipContentDigest(inputs, blocks = []) {
  const chunkCount = inputs.reduce((s, b) => s + Math.ceil(b.length / ZIP_CHUNK), 0);

  const hashBuf = Buffer.alloc(5 + chunkCount * 32);
  hashBuf[0] = 0x5a;
  hashBuf.writeUInt32LE(chunkCount, 1);

  let idx = 0;
  for (const input of inputs) {
    let off = 0;
    while (off < input.length) {
      const n = Math.min(ZIP_CHUNK, input.length - off);
      const prefix = Buffer.alloc(5);
      prefix[0] = 0xa5;
      prefix.writeUInt32LE(n, 1);
      crypto
        .createHash("sha256")
        .update(prefix)
        .update(input.subarray(off, off + n))
        .digest()
        .copy(hashBuf, 5 + idx * 32);
      off += n;
      idx++;
    }
  }

  const md = crypto.createHash("sha256").update(hashBuf);
  for (const block of blocks) md.update(block);
  return md.digest();
}
