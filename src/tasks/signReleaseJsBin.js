import { todo } from "./_util.js";

/**
 * signReleaseJsBin —— 给 .bin 签名
 *
 * Gradle 的开关是 KeyStoreHelper.isUseDefaultSignConfig(buildType.signingConfig)：
 *   配了默认签名 → 直接跳过不签
 *   配了证书    → 调 java -jar hapsigntoolv2.jar sign -mode binlocaljks，模块类型 bin
 *
 * 本 SDK 的打算是不调 jar，用纯 JS 构造签名块。格式已破解，出处是
 * E:\\repo\\hmlw\\hap-sign-utils\\hap-sign-utils\\sign-app-to-hap.js 的 signBin()：
 *
 *   unsignedBin
 *   + proBlock    8 B  0x02|0x00 + uint16 p7bLen + uint32 (unsignedBinLen + 16)
 *   + signBlock   8 B  0x00|0x00 + 0          + uint32 (proBlock + p7bLen)
 *   + p7b 原文
 *   → 按 4096 字节分片各算 SHA256，摘要拼起来再算一次 SHA256（自定义算法，不是标准 SHA256）
 *   → 套 16 字节头 31 30 30 30 00 00 00 01 00 88 00 06 00 00 00 00
 *   → CMS SignedData：sha256 + SHA256withECDSA，
 *     签名属性 signingTime / contentType(1.2.840.113549.1.7.1) / messageDigest
 *   + 32 B signHead：hw signed app   + 1000 + uint32 subBlockSize + uint32 0x02
 *
 * 移植时的坑（照抄来的，别优化）：
 *   1. 私钥和华为根/中间证书是硬编码的，能不能签出设备认的包，
 *      取决于 p7b 里的叶子证书是否与那把私钥配对 —— 不是任意 p7b 都能用
 *   2. p7bLen 只有 uint16，p7b 超过 65535 B 会溢出，必须加断言
 *   3. 分片 chunkSize = 4096 是自定义算法，要与设备验签一致就得原样照抄
 *   4. signHap() 会顺手改 config.json 的 bundleName 和 version.code，那是换壳流程的痕迹，
 *      我们只对 .bin 签，绕开那一层
 *
 * 依赖：允许引入 jsrsasign 做 CMS / ASN.1 编码（零依赖原则的唯一例外）。
 */

export const name = "signReleaseJsBin";
export const produces = "bin/release/entry-release-signed.bin";

export function run(ctx) {
  // 没配证书时直接跳过，与 Gradle 的默认路径一致
  if (!ctx.signingConfig) {
    ctx.paths.signedBin = ctx.paths.unsignedBin;
    return ctx.paths.unsignedBin;
  }

  todo(
    name,
    "已配证书，需要构造签名块（proBlock + signBlock + p7b + CMS SignedData + 32 B signHead）。" +
      "格式见本文件注释，参数在 hap-sign-utils 的 sign-app-to-hap.js"
  );
}

export function verify() {
  // 跳过签名时，signed 文件就是 unsigned 那份，没有独立对照物
  return { ok: true, detail: "未配证书，按默认路径跳过签名（与 gradle 行为一致）" };
}
