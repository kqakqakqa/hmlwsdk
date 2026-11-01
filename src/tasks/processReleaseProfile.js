import fs from "fs";
import path from "path";

import { processProfile, stringifyConfig } from "../profile.js";

/**
 * processReleaseProfile —— config.json 第二阶段加工
 *
 * 实测 Gradle 这一步只调键顺序、不增删字段：
 *   merge_profile/release/config.json
 *   process_profile/release/normal/config.json
 *
 * 所以 processProfile() 现在只是 clone。保留独立函数是为了将来按 SDK
 * 版本做字段迁移（ARK 变体还要追加 module.distro.virtualMachine）时，
 * 改动有地方落。
 */

export const name = "processReleaseProfile";
export const produces = "process_profile/release/normal/config.json";

export function run(ctx) {
  if (!ctx.config) throw new Error(`${name}: 缺少 ctx.config，必须先跑 mergeReleaseProfile`);

  const outDir = path.join(ctx.work, "process_profile", "release", "normal");
  const out = path.join(outDir, "config.json");

  const config = processProfile(ctx.config);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, stringifyConfig(config));

  ctx.config = config;
  ctx.paths.processProfile = out;
  return out;
}
