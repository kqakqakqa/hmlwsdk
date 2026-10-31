import fs from "fs";
import path from "path";

import { compileResources } from "../resources/restool.js";
import { todo } from "./_util.js";

/**
 * compileDebugResources —— 调 restool 编译资源
 *
 * 实测参数（见 src/resources/restool.js）：
 *   -i 资源目录 -b variantsDir -j config.json -p bundleName
 *   -o 输出目录 -r ResourceTable.java -m entry -f
 *
 * 实测对照（apps/_empty/_empty，本机 restool 1.028 vs gradle 当时 1.022）：
 *   R.txt            73 B，SHA256 完全一致
 *   resources.index  337 B，仅偏移 12 的版本号字节不同
 *
 * Gradle 这一步还多做两件事，这里没做：
 *   1. 先删 generated 下的 R 目录和 original_res
 *   2. 读完输出目录里的 config.json，回填框架版本 / API 版本再写回
 */

export const name = "compileDebugResources";
export const produces = "res/<variant>/normal/lite/resources.index + R.txt";

export function run(ctx) {
  if (!ctx.paths.processProfile) todo(name, "缺少 processProfile 产出的 config.json");
  if (!ctx.variantsDir) todo(name, "缺少 variantsDir，必须先跑 mergeResources");

  const outDir = path.join(ctx.work, "res", ctx.variant, "normal", "lite");

  const r = compileResources({
    resourcesDir: path.join(ctx.moduleDir, "src", "main", "resources"),
    variantsDir: ctx.variantsDir,
    configPath: ctx.paths.processProfile,
    bundleName: ctx.config.app.bundleName,
    moduleName: "entry",
    outDir,
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
  const theirs = path.join(ctx.sample, "build", "intermediates", "res", ctx.variant, "normal", "lite");
  const theirRTxt = path.join(theirs, "R.txt");
  const theirIndex = path.join(theirs, "resources.index");

  if (!fs.existsSync(theirRTxt)) return { ok: false, detail: `没有对照产物：${theirRTxt}` };

  // R.txt 应字节一致
  const a = fs.readFileSync(ctx.paths.rTxt);
  const b = fs.readFileSync(theirRTxt);
  if (a.toString("utf8") !== b.toString("utf8")) return { ok: false, detail: "R.txt 字节不一致" };

  // resources.index 允许版本号字节不同（restool 版本差异）
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
