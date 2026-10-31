import fs from "fs";
import path from "path";

import { processProfile, stringifyConfig } from "../config/profile.js";
import { deepEqual } from "./_util.js";

/**
 * processDebugProfile —— config.json 第二阶段加工
 *
 * 实测 Gradle 这一步只调键顺序、不增删字段：
 *   merge_profile/debug/config.json          1064 B
 *   process_profile/debug/normal/config.json 1064 B
 *
 * 所以 processProfile() 现在只是 clone。保留独立函数是为了将来按 SDK
 * 版本做字段迁移（ARK 变体还要追加 module.distro.virtualMachine）时，
 * 改动有地方落。
 */

export const name = "processDebugProfile";
export const produces = "process_profile/<variant>/normal/config.json";

export function run(ctx) {
  if (!ctx.config) throw new Error(`${name}: 缺少 ctx.config，必须先跑 mergeProfile`);

  const outDir = path.join(ctx.work, "process_profile", ctx.variant, "normal");
  const out = path.join(outDir, "config.json");

  const config = processProfile(ctx.config);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, stringifyConfig(config));

  ctx.config = config;
  ctx.paths.processProfile = out;
  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "process_profile", ctx.variant, "normal", "config.json");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const d = deepEqual(ctx.config, JSON.parse(fs.readFileSync(theirs, "utf8")));
  return { ok: !d, detail: d ?? `${fs.statSync(theirs).size} B，内容一致` };
}
