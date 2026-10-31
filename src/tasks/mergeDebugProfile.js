import fs from "fs";
import path from "path";

import { mergeProfile, stringifyConfig } from "../config/profile.js";
import { deepEqual } from "./_util.js";

/**
 * mergeDebugProfile —— config.json 第一阶段加工
 *
 * 实测依据（apps/_empty/_empty/entry）：
 *   源码 src/main/config.json               690 B
 *   → merge_profile/debug/config.json      1064 B
 *
 * 做的三件事：
 *   1. 按 build.gradle 的 compileSdkVersion / compatibleSdkVersion 填 app.apiVersion
 *   2. debug 变体时给 deviceConfig.default 加 debug:true
 *   3. abilities 里没写 homeAbility 的补成 false
 *
 * 未确认项：Gradle 里 if (needPackageBin) 会把 deviceConfig.default.debug 置 true，
 * 但 needPackageBin 对应 build.gradle 哪个开关还没查清，所以这里由 ctx.debug 决定。
 */

export const name = "mergeDebugProfile";
export const produces = "merge_profile/<variant>/config.json";

export function run(ctx) {
  const config = mergeProfile(ctx.srcConfig, {
    compileSdkVersion: ctx.compileSdkVersion,
    compatibleSdkVersion: ctx.compatibleSdkVersion,
    debug: ctx.variant === "debug"
  });

  const out = path.join(ctx.work, "merge_profile", ctx.variant, "config.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, stringifyConfig(config));

  // 交给后面的任务用，省得各自再读一遍文件
  ctx.config = config;
  ctx.paths.mergeProfile = out;
  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "merge_profile", ctx.variant, "config.json");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const d = deepEqual(ctx.config, JSON.parse(fs.readFileSync(theirs, "utf8")));
  return { ok: !d, detail: d ?? `${fs.statSync(theirs).size} B，内容一致（键序不同属正常，gradle 用 HashMap）` };
}
