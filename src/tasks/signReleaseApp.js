import fs from "fs";
import path from "path";

import { prepareSigning, signZip } from "../sign/index.js";
import { todo } from "./_util.js";

/**
 * signReleaseApp —— 给 .app 整体包签名
 *
 * 做法和签 hap 一样：往 .app 这个 zip 的中央目录前插一个 "HAP Sig Block 42"。
 * 实测用 `java -jar hapsigntoolv2.jar sign -mode localjks` 现签了一份 .app，
 * 块格式、摘要算法与本 SDK 的 signZip() 完全一致（digest 逐字节命中），
 * 而 hap 和 .app 用的是同一套块结构，没有单独的 app 分支。
 *
 * 注意 .app 里装的那两个 hap **保持原样**，不重新签名 ——
 * 实测 jar 签出的 .app 里，entry-release-lite.hap 仍是未签的 144 条目文件树形态。
 *
 * Gradle 原本的动作：
 *   1. 输入 outPutsAppDir/<工程名>-release.app
 *   2. 调 SignUtil → java -jar hapsigntoolv2.jar sign -mode localjks（不是 binlocaljks）
 *   3. 输出时把文件名里的 unsigned 换成 signed
 */

export const name = "signReleaseApp";
export const produces = "app/release/<工程名>-release-signed.app";

export function run(ctx) {
  if (!ctx.signingConfig) {
    // 与 Gradle 一致：没配证书就不产出 signed 包
    return null;
  }

  if (!ctx.paths.app) todo(name, "缺少 .app，必须先跑 packageReleaseApp");

  const signing = prepareSigning(ctx.signingConfig);

  const r = signZip({
    zipBuf: fs.readFileSync(ctx.paths.app),
    p7b: signing.p7b,
    keyPem: signing.keyPem,
    certPems: signing.certPems,
    signTime: signing.signTime
  });

  const out = ctx.paths.app.replace("-unsigned", "-signed");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.zip);

  ctx.paths.signedApp = out;
  return out;
}
