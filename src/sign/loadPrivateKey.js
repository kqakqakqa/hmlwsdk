import fs from "fs";
import crypto from "crypto";

/**
 * 签名私钥加载
 *
 * 两种来源，按顺序取第一个能用的：
 *   1. signingConfig.keyFile —— 直接给 PEM 文件
 *   2. signingConfig.p12 + signingConfig.password —— PKCS#12
 *
 * **没有内置私钥、没有默认目录、不读任何环境变量。** 私钥是调用方自己的东西，
 * 必须显式提供，对应 CLI 的 `--key <pem>` 或 `--p12 <p12> --p12pwd <密码>`。
 *
 * 为什么 p12 用 Node 内置 crypto 而不是 jsrsasign：jsrsasign 没有 PKCS#12 解析，
 * 而 Node 15+ 的 crypto.createPrivateKey 直接支持 { format: "pkcs12" }，零依赖。
 *
 * @param {{p12?:string, password?:string, keyFile?:string}} config
 * @returns {{pem:string, source:string}}
 */
export function loadPrivateKey(config = {}) {
  if (config.keyFile) return readPemKey(config.keyFile);

  if (config.p12) return readP12Key(config.p12, config.password);

  throw new Error("missing signing key: pass --key <pem>, or --p12 <p12> --p12pwd <password>");
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
    throw new Error(`${file} is PKCS#12, a password is required (--p12pwd)`);
  }
  const raw = fs.readFileSync(file);
  const key = crypto.createPrivateKey({ key: raw, format: "pkcs12", passphrase: password });
  return { pem: key.export({ type: "pkcs8", format: "pem" }), source: `${file} (password verified)` };
}
