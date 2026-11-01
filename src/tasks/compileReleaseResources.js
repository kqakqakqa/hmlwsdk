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
