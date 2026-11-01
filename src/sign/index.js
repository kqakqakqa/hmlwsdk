import fs from "fs";

import { parseP7b, nowSignTime } from "./p7b.js";
import { loadPrivateKey } from "./key.js";
import { HUAWEI_CHAIN_PEM, splitPemCerts } from "./certs.js";
import { signBin } from "./bin.js";
import { signZip } from "./zip.js";

export { signBin, signZip };
export { parseP7b, nowSignTime } from "./p7b.js";
export { loadPrivateKey, defaultCertDirs } from "./key.js";
export { slicedSha256, zipContentDigest } from "./digest.js";
export { buildSignedData, sortCertChain } from "./cms.js";
export { stripZipSignature, readZipLayout } from "./zip.js";

/**
 * 把 signingConfig 变成签名要用的材料
 *
 * signingConfig 的形状：p7b 必给，私钥三选一
 *   { p7b: "...", p12: "...", password: "..." }   PKCS#12
 *   { p7b: "...", keyFile: "private-pkcs8.pem" }   裸 PEM
 *   { p7b: "..." }                                 用 hap-sign-utils/cer 下的默认私钥
 * 另外可选 certPath 替换内置的华为根+中间证书链。
 *
 * @param {{p7b:string, p12?:string, password?:string, keyFile?:string, certPath?:string, signTime?:string}} config
 */
export function prepareSigning(config) {
  if (!config?.p7b) throw new Error("签名至少要给 p7b 路径（--p7b）");
  if (!fs.existsSync(config.p7b)) throw new Error(`p7b 不存在：${config.p7b}`);

  const p7b = fs.readFileSync(config.p7b);
  const profile = parseP7b(p7b);
  const key = loadPrivateKey(config);

  const chain = config.certPath
    ? splitPemCerts(fs.readFileSync(config.certPath, "utf8"))
    : splitPemCerts(HUAWEI_CHAIN_PEM);

  if (chain.length < 2) throw new Error(`证书链里只找到 ${chain.length} 张证书，至少要根+中间两张`);

  return {
    profile,
    p7b,
    keyPem: key.pem,
    keySource: key.source,
    certPems: [profile.leafCertPem, ...chain],
    // 签名时间取当前时刻。实测 Gradle 的产物也是签名当时的时刻，
    // 而不是 p7b 的 not-before（那个正好压在证书有效期下边界，会被判非法）
    signTime: config.signTime ?? nowSignTime()
  };
}
