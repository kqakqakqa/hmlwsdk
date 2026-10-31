import fs from "fs";
import path from "path";

import { stringifyConfig } from "../config/profile.js";
import { parseRTable, fillResourceIds } from "../resources/rtable.js";
import { todo } from "./_util.js";

/**
 * generateDebugBinSource —— 组装 .bin 的原料目录
 *
 * 整条链最大的缺口。Gradle 的实现类叫 GenerateJsBinSource（注解写着
 * Use Node.js，但实现里一行 node 都没调，全是 copy）。
 *
 * 实测产出（js/debug/source/lite，16 个文件）：
 *   config.json                       1137 B
 *   assets/entry/resources.index       337 B
 *   assets/entry/resources/base/media/attributes.key   1 B
 *   assets/entry/resources/base/media/constants.key    1 B
 *   assets/entry/resources/base/media/contents.key     1 B
 *   assets/entry/resources/base/media/nodes.key        1 B
 *   assets/entry/resources/base/media/icon.bin     51992 B
 *   assets/entry/resources/base/media/icon.png      6320 B
 *   assets/entry/resources/base/media/icon_small.bin  25608 B
 *   assets/entry/resources/base/media/icon_small.png   5448 B
 *   assets/js/default/app.js / app.bc / manifest.json
 *   assets/js/default/pages/index/index.js / index.bc
 *
 * 注意 .png 和 .bin 并存 —— Gradle 复制 assets 时只排除 .txt 后缀，没排除 .png。
 * 而 .bin 那批不是 restool 的产物，是 ace-loader 的 ImageCoverterPlugin
 * 在 webpack 阶段顺手做的（webpack.lite.config.js 第 185 行）。
 */

export const name = "generateDebugBinSource";
export const produces = "js/<variant>/source/lite/ 整个目录 + config.json 1137 B";

export function run(ctx) {
  const sourceRoot = path.join(ctx.work, "js", ctx.variant, "source", "lite");
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(sourceRoot, { recursive: true });

  // ── 第 1 段：config.json 加工。这部分已能跑，产物 1137 B ──────────────
  // 三处改动才能从 1064 B 变成 1137 B：
  //   1. abilities 里回填 iconId / labelId（从 R.txt 查出来）
  //   2. deviceType 清空后只写回 LITE_WEARABLE
  //   3. prettyPrint 写出
  if (!ctx.config) todo(name, "缺少 ctx.config，必须先跑 mergeProfile");
  if (!ctx.paths.rTxt) todo(name, "缺少 R.txt，必须先跑 compileResources");

  const rtable = parseRTable(fs.readFileSync(ctx.paths.rTxt, "utf8"));
  const config = structuredClone(ctx.config);
  fillResourceIds(config, rtable);

  if (config.module) {
    config.module.deviceType = ["liteWearable"];
  }

  const configOut = path.join(sourceRoot, "config.json");
  fs.writeFileSync(configOut, stringifyConfig(config));
  ctx.paths.binSource = sourceRoot;
  ctx.paths.binSourceConfig = configOut;

  // ── 第 2 段：复制 assets ────────────────────────────────────────────
  // TODO 没实现。要做的是：
  //   a. 把 moduleDir/src/main 下的 assets 复制过来，只排除 **/*.txt
  //   b. 把 webpack 产物（ctx.paths.jsBuild）里的 **/*.bin 复制过来
  //   c. resources.index 放到 assets/entry/ 下
  //   d. restool 输出的 *.key（每个 1 B）也要放到 assets/entry/resources/base/media/
  // 缺 (b) 和 (d) 的输入时没法验证，所以先留空。

  return sourceRoot;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "js", ctx.variant, "source", "lite", "config.json");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const mine = fs.readFileSync(ctx.paths.binSourceConfig);
  const want = fs.readFileSync(theirs);
  if (mine.toString("utf8") !== want.toString("utf8")) {
    return { ok: false, detail: `config.json 不同：我 ${mine.length} B，gradle ${want.length} B（assets 复制这部分还没做）` };
  }
  return { ok: true, detail: `config.json ${want.length} B 字节一致（assets 复制仍未实现）` };
}
