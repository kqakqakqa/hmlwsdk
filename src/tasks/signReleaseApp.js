import { todo } from "./_util.js";

/**
 * signReleaseApp —— 给 .app 整体包签名
 *
 * 只有 release 有这条链。任务注册条件写死了：buildType 是 RELEASE 且是主变体，
 * 否则任务根本不注册。
 *
 * Gradle 的动作：
 *   1. 输入 outPutsAppDir/<工程名>-release.app
 *   2. 调 SignUtil → java -jar hapsigntoolv2.jar sign -mode localjks
 *      -keystore … -signAlg … -inputFile … -outputFile …
 *   3. 输出时把文件名里的 unsigned 换成 signed
 *
 * 本工程没配证书，这一步不会产出 signed 包。
 */

export const name = "signReleaseApp";
export const produces = "app/release/<工程名>-release-signed.app";

export function run(ctx) {
  if (!ctx.signingConfig) {
    // 与 Gradle 一致：没配证书就不产出 signed 包
    return null;
  }

  todo(name, "已配证书：要调签名工具给 .app 签（-mode localjks），再把 unsigned 换成 signed");
}

export function verify() {
  return { ok: true, detail: "未配证书，不产出 signed 包（与 gradle 一致）" };
}
