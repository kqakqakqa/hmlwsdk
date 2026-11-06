import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { loadPrivateKey } from "./sign/loadPrivateKey.js";

/**
 * 读项目内的签名材料 —— cert/ 目录就是签名配置
 *
 * 约定（AGENTS.md 的「工作约定」那节要求模块有对照，这块是新增的，没有字节级对照，
 * 只有下面这几条行为规则，实测见本文件末尾的注释）：
 *
 *   cert/ 不存在                    → 返回 undefined，这个工程不签名
 *   cert/ 里没有 .p7b               → 返回 undefined（同上）
 *   cert/ 里有 p7b 但没有私钥        → 报错（有 p7b 就说明想签，缺私钥不能静默跳过）
 *   cert/signing.config.js 写了路径  → 用它，文件必须真实存在
 *   没写                            → 扫 cert/ 顶层，取唯一一个 .p7b / 私钥
 *   扫出多个                        → 报错，让人在 signing.config.js 里点名
 *
 * 密码：signing.config.js 里写了就用它；没写就拿 **p12 的文件名**试
 * （signing.p12 和 signing 各试一次）。试通了再把结果回写进 signing.config.js，
 * 下次就不用试了。
 *
 * **回写是刻意设计的**：把文件丢进 cert/ 就完事，不用手写配置。
 * 目录本身有 .gitignore（`*` + `!.gitignore`），所以含明文密码的
 * signing.config.js 天然不会进版本库 —— 这也是它被放在 cert/ 而不是工程根的原因。
 */

export const CERT_DIR = "cert";
export const SIGNING_CONFIG_NAME = "signing.config.js";

const P7B_EXT = ".p7b";
const P12_EXT = ".p12";
const PEM_EXT = ".pem";

/**
 * @param {string} root 工程根
 * @returns {Promise<{p7b:string, p12?:string, password?:string, keyFile?:string, certPath?:string}|undefined>}
 *          形状与 prepareSigning 要的 signingConfig 一致；undefined = 不签名
 */
export async function readSigningConfig(root) {
  const certDir = path.join(root, CERT_DIR);
  if (!fs.existsSync(certDir)) return undefined;

  const configPath = path.join(certDir, SIGNING_CONFIG_NAME);
  const saved = fs.existsSync(configPath)
    ? (await import(pathToFileURL(configPath).href)).default ?? {}
    : {};

  const p7b = pickFile(certDir, saved.p7b, [P7B_EXT], "profile");
  if (!p7b) return undefined;

  const key = pickKey(certDir, saved);
  const password = key.kind === "pem" ? undefined : pickPassword(key.file, saved.password);

  const next = {
    p7b: toConfigPath(certDir, p7b),
    [key.kind === "pem" ? "keyFile" : "p12"]: toConfigPath(certDir, key.file),
    ...(password === undefined ? {} : { password }),
    ...(saved.certPath ? { certPath: saved.certPath } : {})
  };
  if (!sameFields(saved, next)) writeSigningConfig(configPath, next);

  return {
    p7b,
    ...(key.kind === "pem" ? { keyFile: key.file } : { p12: key.file, password }),
    ...(saved.certPath ? { certPath: path.resolve(certDir, saved.certPath) } : {})
  };
}

/**
 * 定位 p7b：配置里写了就用它，没写就扫目录取唯一一个
 * 找不到返回 undefined（= 不签名），多于一个报错（不猜）
 */
function pickFile(certDir, declared, exts, label) {
  if (declared) {
    const p = path.resolve(certDir, declared);
    if (!fs.existsSync(p)) throw new Error(`${CERT_DIR}/${SIGNING_CONFIG_NAME} declares ${label} ${declared}, but that file is not there`);
    return p;
  }

  const found = listFiles(certDir, exts);
  if (found.length > 1) {
    throw new Error(
      `found ${found.length} ${label} files in ${certDir}: ${found.map((f) => path.basename(f)).join(", ")}\n` +
        `name the one to use in ${CERT_DIR}/${SIGNING_CONFIG_NAME} as ${label === "profile" ? "p7b" : "keyFile"}, ` +
        "or delete the others"
    );
  }
  return found[0];
}

/**
 * 定位私钥：.p12（PKCS#12，要密码）或 .pem（裸私钥，不要密码）
 * 两种同时存在时报错 —— 挑哪个都是猜
 */
function pickKey(certDir, saved) {
  if (saved.keyFile) {
    const p = path.resolve(certDir, saved.keyFile);
    if (!fs.existsSync(p)) throw new Error(`${CERT_DIR}/${SIGNING_CONFIG_NAME} declares keyFile ${saved.keyFile}, but that file is not there`);
    return { file: p, kind: "pem" };
  }
  if (saved.p12) {
    const p = path.resolve(certDir, saved.p12);
    if (!fs.existsSync(p)) throw new Error(`${CERT_DIR}/${SIGNING_CONFIG_NAME} declares p12 ${saved.p12}, but that file is not there`);
    return { file: p, kind: "p12" };
  }

  const found = listFiles(certDir, [P12_EXT, PEM_EXT]).map((file) => ({
    file,
    kind: path.extname(file).toLowerCase() === P12_EXT ? "p12" : "pem"
  }));

  if (found.length === 0) {
    throw new Error(
      `${certDir} has a profile but no signing key — drop a .p12 or a PKCS#8 .pem in there, ` +
        `or name it in ${CERT_DIR}/${SIGNING_CONFIG_NAME}`
    );
  }
  if (found.length > 1) {
    throw new Error(
      `found ${found.length} signing keys in ${certDir}: ${found.map((f) => path.basename(f.file)).join(", ")}\n` +
        `name the one to use in ${CERT_DIR}/${SIGNING_CONFIG_NAME} as p12 or keyFile, or delete the others`
    );
  }
  return found[0];
}

/**
 * 确定 p12 密码
 *
 * 显式写了就必须能开 —— 打不开直接报错，不再拿文件名去试，
 * 否则用户写错了密码却「碰巧」被文件名救了，以后会莫名其妙失效。
 * 没写才拿 **p12 自己的文件名** 试两个候选：signing.p12 和 signing。
 *
 * 用 p12 的文件名而不是 p7b 的：华为导出的私钥库习惯把密码设成库名，
 * 而 p7b 常常是另一个名字（AGC 上申请出来的 profile）。
 */
function pickPassword(p12, declared) {
  if (declared !== undefined) {
    const err = tryOpen(p12, declared);
    if (err) {
      throw new Error(
        `${CERT_DIR}/${SIGNING_CONFIG_NAME} has password for ${path.basename(p12)}, but it does not open it: ${err.message}`
      );
    }
    return declared;
  }

  const candidates = [...new Set([path.basename(p12), path.basename(p12, P12_EXT)])];
  for (const candidate of candidates) {
    if (!tryOpen(p12, candidate)) return candidate;
  }

  throw new Error(
    `${path.basename(p12)} needs a password and none of the guesses worked ` +
      `(tried ${candidates.map((c) => `"${c}"`).join(", ")} — the p12 file name)\n` +
      `write it as password in ${CERT_DIR}/${SIGNING_CONFIG_NAME}`
  );
}

/** 能打开返回 null，打不开返回错误对象 */
function tryOpen(p12, password) {
  try {
    loadPrivateKey({ p12, password });
    return null;
  } catch (e) {
    return e;
  }
}

/** 只扫 cert/ 顶层 —— 递归会撞上用户自己建的备份子目录 */
function listFiles(dir, exts) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && exts.includes(path.extname(d.name).toLowerCase()))
    .map((d) => path.join(dir, d.name))
    .sort();
}

/** 配置里存相对 cert/ 的路径（signing.config.js 就在 cert/ 里，跟 tsconfig 那种一致），正斜杠 */
function toConfigPath(certDir, abs) {
  return path.relative(certDir, abs).replace(/\\/g, "/");
}

function sameFields(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * 回写 signing.config.js
 *
 * 这个文件被 cert/.gitignore 忽略（含明文密码），所以直接写成可被 import() 读的
 * ESM —— 工程根 package.json 的 "type": "module" 由 init 保证。
 */
function writeSigningConfig(configPath, config) {
  const body = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join(",\n");

  fs.writeFileSync(
    configPath,
    `/**\n` +
      ` * Generated/updated by hmlwsdk — written back once signing material was found in cert/, so nothing has to be guessed next time.\n` +
      ` * This file holds a plaintext password; cert/.gitignore ignores the whole directory, so it never reaches version control.\n` +
      ` * Paths are relative to the cert/ directory.\n` +
      ` */\n` +
      `export default {\n${body}\n};\n`
  );
}
