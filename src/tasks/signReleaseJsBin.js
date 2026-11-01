import fs from "fs";
import path from "path";

import { prepareSigning, signBin } from "../sign/index.js";
import { isSignedBin, stripSignature, readBin } from "../bin/index.js";
import { todo } from "./_util.js";

/**
 * signReleaseJsBin —— 给 .bin 签名
 *
 * Gradle 在这里调 `java -jar hapsigntoolv2.jar sign -mode binlocaljks`；
 * 本 SDK 用纯 JS 构造签名块，格式照抄 hap-sign-utils/sign-app-to-hap.js 的 signBin()。
 *
 * 实测对照（拿 apps/_3rd/随机事件 的 Gradle 产物逐段比）：
 *   proBlock    完全一致  02000fe30069497a
 *   signBlock   完全一致
 *   econtent 头 完全一致  31303030003000010088000600000020
 * 只有 CMS 里的签名值不同 —— 那部分取决于私钥，本来就无法字节一致。
 *
 * 没配证书时走 Gradle 的默认路径：不签，直接把 unsigned 当 signed 传给下游。
 */

export const name = "signReleaseJsBin";
export const produces = "bin/release/entry-release-signed.bin";

export function run(ctx) {
  if (!ctx.paths.unsignedBin) todo(name, "缺少 .bin，必须先跑 generateReleaseJsBin");

  if (!ctx.signingConfig) {
    ctx.paths.signedBin = ctx.paths.unsignedBin;
    return ctx.paths.unsignedBin;
  }

  const signing = prepareSigning(ctx.signingConfig);

  const signed = signBin({
    unsignedBin: fs.readFileSync(ctx.paths.unsignedBin),
    p7b: signing.p7b,
    keyPem: signing.keyPem,
    certPems: signing.certPems,
    signTime: signing.signTime
  });

  const outDir = path.join(ctx.work, "bin", "release");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "entry-release-signed.bin");
  fs.writeFileSync(out, signed);

  ctx.paths.signedBin = out;
  return out;
}

export function verify(ctx) {
  if (!ctx.signingConfig) {
    return { ok: true, detail: "未配证书，按默认路径跳过签名（与 gradle 行为一致）" };
  }
  if (!isSignedBin(fs.readFileSync(ctx.paths.signedBin))) {
    return { ok: false, detail: "产物没有签名尾巴" };
  }

  const buf = fs.readFileSync(ctx.paths.signedBin);
  const unsigned = stripSignature(buf);
  const subBlockSize = buf.readUInt32BE(buf.length - 12);

  if (subBlockSize !== buf.length - unsigned.length) {
    return { ok: false, detail: `subBlockSize ${subBlockSize} ≠ 总长-unsigned ${buf.length - unsigned.length}` };
  }

  const parsed = readBin(buf);
  return {
    ok: true,
    detail: `签名块 ${subBlockSize} B，剥掉后 ${unsigned.length} B 可解析出 ${parsed.entries.length} 个条目`
  };
}
