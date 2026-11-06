import { prepareSigning, signZip } from "./sign/index.js";

/**
 * 给 .app 整体包签名
 *
 * 做法和签 hap 一样：往 .app 这个 zip 的中央目录前插一个 "HAP Sig Block 42"。
 * 实测用 `java -jar hapsigntoolv2.jar sign -mode localjks` 现签了一份 .app，
 * 块格式、摘要算法与 signZip() 完全一致（digest 逐字节命中），
 * 而 hap 和 .app 用的是同一套块结构，没有单独的 app 分支。
 *
 * 注意 .app 里装的那个 hap **保持原样**，不重新签名 ——
 * 实测 jar 签出的 .app 里，entry-release-lite.hap 仍是未签的 144 条目文件树形态。
 *
 * 只有 .app 自己的 zip 层需要签，因为 hapsigntoolv2.jar verify 读的就是它。
 *
 * 只处理 Buffer，不碰文件 —— 落盘由调用方（build.js）负责。
 */

/**
 * @param {object} opts
 * @param {Buffer} opts.appBuf        未签名的 .app
 * @param {object} opts.signingConfig { p7b, p12?, password?, keyFile?, certPath? }
 * @returns {Buffer} 签名后的 .app
 */
export function signApp(opts) {
  const signing = prepareSigning(opts.signingConfig);

  return signZip({
    zipBuf: opts.appBuf,
    p7b: signing.p7b,
    keyPem: signing.keyPem,
    certPems: signing.certPems,
    signTime: signing.signTime
  }).zip;
}
