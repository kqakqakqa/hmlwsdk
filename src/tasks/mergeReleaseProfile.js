import fs from "fs";
import path from "path";

import { mergeProfile, stringifyConfig } from "../config/profile.js";
import { deepEqual } from "./_util.js";

/**
 * mergeReleaseProfile —— config.json 第一阶段加工
 *
 * 实测依据（apps/devdemo/devdemo/entry）：
 *   merge_profile/release/config.json
 *
 * 做的三件事：
 *   1. 按 build.gradle 的 compileSdkVersion / compatibleSdkVersion 填 app.apiVersion
 *   2. release 变体**不加** deviceConfig.default.debug（实测 devdemo 的 release
 *      config.json 里 deviceConfig 是空对象 {}，而 debug 那份是 {"default":{"debug":true}}）
 *   3. abilities 里没写 homeAbility 的补成 false
 *
 * 未确认项：Gradle 里 if (needPackageBin) 会把 deviceConfig.default.debug 置 true，
 * 但 needPackageBin 对应 build.gradle 哪个开关还没查清。
 */

export const name = "mergeReleaseProfile";
export const produces = "merge_profile/release/config.json";

export function run(ctx) {
  const config = mergeProfile(ctx.srcConfig, {
    compileSdkVersion: ctx.compileSdkVersion,
    compatibleSdkVersion: ctx.compatibleSdkVersion,
    debug: false // release 变体不写 debug:true
  });

  const out = path.join(ctx.work, "merge_profile", "release", "config.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, stringifyConfig(config));

  // 交给后面的任务用，省得各自再读一遍文件
  ctx.config = config;
  ctx.paths.mergeProfile = out;
  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "merge_profile", "release", "config.json");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const d = deepEqual(ctx.config, JSON.parse(fs.readFileSync(theirs, "utf8")));
  return { ok: !d, detail: d ?? `${fs.statSync(theirs).size} B，内容一致（键序不同属正常，gradle 用 HashMap）` };
}
