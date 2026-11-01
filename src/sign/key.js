import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 签名私钥加载
 *
 * 三种来源，按顺序取第一个能用的：
 *   1. signingConfig.keyFile —— 直接给 PEM 文件
 *   2. signingConfig.p12 + signingConfig.password —— PKCS#12
 *   3. 默认目录（见 DEFAULT_CERT_DIRS）里找 p12，再找 private-pkcs8.pem
 *
 * 为什么 p12 用 Node 内置 crypto 而不是 jsrsasign：jsrsasign 没有 PKCS#12 解析，
 * 而 Node 15+ 的 crypto.createPrivateKey 直接支持 { format: "pkcs12" }，零依赖。
 *
 * 实测（本机）：hap-sign-utils/cer/default.p12 的密码不是 "default"/"123456"/空，
 * 打不开；但同目录的 private-pkcs8.pem 与 poweroftwoRelease.p7b 的
 * distribution-certificate 配对（SPKI 字节一致），所以默认走 pem。
 * 也就是说"默认 hap-sign-utils 的私钥"在实现上取到的是同一把 key。
 *
 * @param {{p12?:string, password?:string, keyFile?:string}} config
 * @returns {{pem:string, source:string}}
 */
export function loadPrivateKey(config = {}) {
  if (config.keyFile) return readPemKey(config.keyFile);

  if (config.p12) return readP12Key(config.p12, config.password);

  for (const dir of defaultCertDirs()) {
    if (!fs.existsSync(dir)) continue;

    const p12 = path.join(dir, "default.p12");
    if (fs.existsSync(p12) && config.password) {
      try {
        return readP12Key(p12, config.password);
      } catch {
        // 密码不对就继续往下找 pem
      }
    }

    const pem = path.join(dir, "private-pkcs8.pem");
    if (fs.existsSync(pem)) return readPemKey(pem);
  }

  throw new Error(
    "找不到签名私钥。用 --key <pem> 指定，或用 --p12 <p12> --p12pwd <密码>，\n" +
      `或者把 private-pkcs8.pem 放到这些目录之一：${defaultCertDirs().join(", ")}`
  );
}

function readPemKey(file) {
  const pem = fs.readFileSync(file, "utf8");
  const key = crypto.createPrivateKey(pem);
  return { pem: key.export({ type: "pkcs8", format: "pem" }), source: file };
}

function readP12Key(file, password) {
  if (password === undefined) {
    throw new Error(`${file} 是 PKCS#12，必须给密码（--p12pwd）`);
  }
  const raw = fs.readFileSync(file);
  const key = crypto.createPrivateKey({ key: raw, format: "pkcs12", passphrase: password });
  return { pem: key.export({ type: "pkcs8", format: "pem" }), source: `${file}（密码校验通过）` };
}

/**
 * 默认签名材料目录
 *
 * 环境变量 HMLW_SIGN_CERTS 优先；否则按仓库布局推 —— 本 SDK 在 <root>/hmlwsdk，
 * 签名材料在 <root>/hap-sign-utils/cer。
 */
export function defaultCertDirs() {
  const dirs = [];
  if (process.env.HMLW_SIGN_CERTS) dirs.push(process.env.HMLW_SIGN_CERTS);
  dirs.push(path.resolve(HERE, "..", "..", "..", "hap-sign-utils", "cer"));
  return dirs.map((d) => d.replace(/\\/g, "/"));
}
