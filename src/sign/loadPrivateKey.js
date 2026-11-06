import fs from "fs";
import crypto from "crypto";

import { parseP12 } from "./parseP12.js";

/**
 * 签名私钥加载
 *
 * 两种来源，按顺序取第一个能用的：
 *   1. signingConfig.keyFile —— 直接给 PEM 文件
 *   2. signingConfig.p12 + signingConfig.password —— PKCS#12
 *
 * **没有内置私钥、没有默认目录、不读任何环境变量。** 私钥是调用方自己的东西，
 * 必须显式提供。CLI 上的来源是工程里的 cert/ 目录，见 src/readSigningConfig.js。
 *
 * 两种格式的区别：
 *   PEM 是私钥的**明文文本**，拿到就能签，crypto.createPrivateKey 直接读。
 *   PKCS#12（.p12）是私钥的**加密码包**，要先解密再把里面的 PKCS#8 拆出来，才能变成 PEM。
 *   DevEco / AGC 导出的签名材料是后者，解包实现在 parseP12.js。
 *
 * ⚠ 早先这里写的是 `crypto.createPrivateKey({ key, format: "pkcs12" })`，那个 format 值
 * **从来就不合法**（createPrivateKey 只认 pem/der/jwk/raw-*），实测 Node v26.13.0 报
 * "The property 'key.format' is invalid" —— 也就是说这条分支在修之前一次都没跑通过
 * （历史所有签名验证用的都是 .pem 私钥）。现在 p12 走 parseP12.js，任何 Node 版本都能用。
 *
 * @param {{p12?:string, password?:string, keyFile?:string}} config
 * @returns {{pem:string, source:string}}
 */
export function loadPrivateKey(config = {}) {
  if (config.keyFile) return readPemKey(config.keyFile);

  if (config.p12) return readP12Key(config.p12, config.password);

  throw new Error("missing signing key: put a .p12 or a PKCS#8 .pem in cert/ (or set keyFile/p12 in cert/signing.config.js)");
}

function readPemKey(file) {
  if (!fs.existsSync(file)) throw new Error(`private key file not found: ${file}`);
  const pem = fs.readFileSync(file, "utf8");
  const key = crypto.createPrivateKey(pem);
  return { pem: key.export({ type: "pkcs8", format: "pem" }), source: file };
}

function readP12Key(file, password) {
  if (!fs.existsSync(file)) throw new Error(`private key file not found: ${file}`);
  if (password === undefined) {
    throw new Error(`${file} is PKCS#12, a password is required — set it as password in cert/signing.config.js`);
  }

  // 密码错了 parseP12 会抛错 —— readSigningConfig 的 pickPassword 靠这个判断
  // 「拿 p12 文件名当密码」的候选试没试对，所以不能吞异常
  return { pem: parseP12(fs.readFileSync(file), password), source: `${file} (password verified)` };
}
