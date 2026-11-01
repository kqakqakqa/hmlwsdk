import fs from "fs";
import path from "path";

import { compileResources } from "../resources/restool.js";
import { todo } from "./_util.js";

/**
 * compileReleaseResources —— 调 restool 编译资源
 *
 * 实测参数（见 src/resources/restool.js）：
 *   -i 模块根 src/main -j config.json -p bundleName -o 输出目录
 *   -r ResourceTable.java -m entry -f -z
 *
 * 实测对照（apps/_empty/_empty，restool -v 报 1.022，与 Gradle 当时同版本）：
 *   R.txt            73 B，SHA256 651EFBDB…，字节一致
 *   resources.index  337 B，SHA256 08F3CD66…，字节一致
 *   icon.png         6320 B，SHA256 D8734140…，字节一致（这是 -z 压缩后的产物）
 *
 * Gradle 这一步还多做两件事，这里没做：
 *   1. 先删 generated 下的 R 目录和 original_res
 *   2. 读完输出目录里的 config.json，回填框架版本 / API 版本再写回
 *
 * 变体无关：restool 的参数不区分变体，只有输出目录名不同。
 */

export const name = "compileReleaseResources";
export const produces = "res/release/normal/lite/resources.index + R.txt";

export function run(ctx) {
  if (!ctx.paths.processProfile) todo(name, "缺少 processProfile 产出的 config.json");
  if (!ctx.variantsDir) todo(name, "缺少 variantsDir，必须先跑 mergeReleaseResources");

  const outDir = path.join(ctx.work, "res", "release", "normal", "lite");

  const r = compileResources({
    // ⚠ api6 的 -i 要指向**模块根目录** src/main，不是 src/main/resources。
    // 实测（api6 restool 批量试参数）：传 src/main/resources 会报
    //   Error: config.json ref:'$media:icon' don't be defined
    // 传 src/main 才能跑通，产物是 config.json + R.txt + resources/ + resources.index。
    // api7 的 restool 才有 -b 参数把 variants 目录单列出来，这里不需要。
    moduleRoot: path.join(ctx.moduleDir, "src", "main"),
    configPath: ctx.paths.processProfile,
    bundleName: ctx.config.app.bundleName,
    moduleName: "entry",
    outDir,
    // -z 压缩图片。不传的话 png 是源码原样大小（_empty 的 icon.png 6790 B），
    // 传了才是 Gradle 产物那样（6320 B，SHA256 D8734140…）。
    compressImage: true,
    force: true
  });

  if (!r.ok) {
    throw new Error(`${name} 失败（restool 返回 ${r.code}）\n${r.stdout}\n${r.stderr}`);
  }

  ctx.paths.resources = r.indexFile;
  ctx.paths.rTxt = r.rTxtFile;
  return outDir;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "res", "release", "normal", "lite");
  const theirRTxt = path.join(theirs, "R.txt");
  const theirIndex = path.join(theirs, "resources.index");

  if (!fs.existsSync(theirRTxt)) return { ok: false, detail: `没有对照产物：${theirRTxt}` };

  // R.txt 应字节一致
  const a = fs.readFileSync(ctx.paths.rTxt);
  const b = fs.readFileSync(theirRTxt);
  if (a.toString("utf8") !== b.toString("utf8")) {
    return { ok: false, detail: `R.txt 字节不一致：我 ${a.length} B，gradle ${b.length} B` };
  }

  // 本机实测 resources.index 也是 0 差异。这里仍容忍 1 个字节，是留给换用
  // 其他版本 restool 的余量（比如 api7 的 1.028，index 里的版本号字符串不同）。
  if (!fs.existsSync(theirIndex)) return { ok: true, detail: `R.txt ${a.length} B 一致（没有 index 可对照）` };

  const x = fs.readFileSync(ctx.paths.resources);
  const y = fs.readFileSync(theirIndex);
  if (x.length !== y.length) return { ok: false, detail: `index 尺寸不同 ${x.length} vs ${y.length}` };

  const diff = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff.push(i);
  if (diff.length > 1) return { ok: false, detail: `index 差异字节过多：${diff.join(",")}` };

  return {
    ok: true,
    detail: `R.txt ${a.length} B 一致，index ${x.length} B 仅偏移 ${diff.join(",") || "无"} 不同`
  };
}
