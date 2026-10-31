import fs from "fs";
import path from "path";

import { compileJs } from "../js/aceLoader.js";
import { todo } from "./_util.js";

/**
 * compileDebugJsWithNode —— node + webpack 编译 JS/HML/CSS
 *
 * 实测命令（apps/_empty/_empty，见 src/js/aceLoader.js）：
 *   node --openssl-legacy-provider <ace-loader>/node_modules/webpack/bin/webpack.js
 *        --config <ace-loader>/webpack.lite.config.js
 *        --env deviceType=liteWearable buildMode=debug sourceMap=none
 *
 * 实测耗时：首次 59 s（webpack cache 为空），第二次 1.76 s。
 * 所以这个任务不该塞进快速自检里，build.js 默认要允许跳过（--skip-js）。
 *
 * 输入 ctx.paths.jsManifest（aceManifestPath），产出 webpack 的 js/bc 文件。
 *
 * 未验证：release 变体的 mode production、sourcemap 挪到 _releaseMap/ 这两条。
 */

export const name = "compileDebugJsWithNode";
export const produces = "js/<variant>/source/lite/assets/js/<组件>/*.js|*.bc";

export function run(ctx) {
  if (!ctx.paths.jsManifest) todo(name, "缺少 jsManifest，必须先跑 generateJsManifest");

  const buildDir = path.join(ctx.work, "js", ctx.variant, "source", "lite");

  const r = compileJs({
    moduleRoot: path.join(ctx.moduleDir, "src", "main"),
    buildDir,
    manifestPath: ctx.paths.jsManifest,
    buildMode: ctx.variant,
    deviceType: "liteWearable",
    hapMode: true
  });

  if (!r.ok) {
    throw new Error(
      `${name} 失败（webpack 返回 ${r.code}）\n` +
        (r.stdout ?? "").slice(-3000) +
        "\n" +
        (r.stderr ?? "").slice(-2000)
    );
  }

  ctx.paths.jsBuild = buildDir;
  return buildDir;
}

export function verify(ctx) {
  const jsDir = path.join(ctx.sample, "build", "intermediates", "js", ctx.variant, "source", "lite", "assets", "js", "default");
  const want = [
    ["app.js", 5983],
    ["app.bc", 2344],
    ["manifest.json", 274],
    [path.join("pages", "index", "index.js"), 7052],
    [path.join("pages", "index", "index.bc"), 3614]
  ];

  const bad = [];
  for (const [rel, bytes] of want) {
    const p = path.join(jsDir, rel);
    if (!fs.existsSync(p)) bad.push(`${rel} 不存在`);
    else if (fs.statSync(p).size !== bytes) bad.push(`${rel} ${fs.statSync(p).size} B ≠ ${bytes} B`);
  }
  if (bad.length) return { ok: false, detail: bad.join("；") };
  return { ok: true, detail: "5 个产物尺寸全部对上（app.js 5983 / app.bc 2344 / index.js 7052 …）" };
}
