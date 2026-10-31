import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

import { resolveTools, resolveNode } from "../sdk.js";

/**
 * 调 node + ace-loader/webpack 编译 JS/HML/CSS
 *
 * 对应 Gradle 的 compileDebugJsWithNode。
 *
 * 实测命令（apps/_empty/_empty）：
 *   node --openssl-legacy-provider <ace-loader>/node_modules/webpack/bin/webpack.js
 *        --config <ace-loader>/webpack.lite.config.js
 *        --env deviceType=liteWearable buildMode=debug sourceMap=none
 *   环境变量：aceModuleRoot / aceModuleBuild / aceManifestPath / watchMode=false / hapMode
 *
 * 实测耗时：首次 59 s（webpack cache 为空），第二次 1.76 s。
 *
 * 注意：webpack.lite.config.js 第 138 行会 deleteFolderRecursive(buildPath)，
 * 所以 buildDir 必须是专用目录，不要指到别的产物目录上。
 */
export function compileJs(opts) {
  const tools = opts.tools ?? resolveTools(opts.sdkRoot);
  const node = opts.node ?? resolveNode();

  const webpackBin = path.join(tools.aceLoader, "node_modules", "webpack", "bin", "webpack.js");
  const webpackConfig = path.join(tools.aceLoader, "webpack.lite.config.js");

  if (!fs.existsSync(webpackBin)) throw new Error(`找不到 webpack：${webpackBin}`);
  if (!fs.existsSync(webpackConfig)) throw new Error(`找不到 webpack 配置：${webpackConfig}`);

  fs.mkdirSync(opts.buildDir, { recursive: true });

  const env = {
    ...process.env,
    aceModuleRoot: opts.moduleRoot,
    aceModuleBuild: opts.buildDir,
    aceManifestPath: opts.manifestPath,
    watchMode: "false",
    buildMode: opts.buildMode ?? "debug",
    hapMode: opts.hapMode ? "true" : "false"
  };

  const args = [
    "--openssl-legacy-provider",
    webpackBin,
    "--config", webpackConfig,
    "--env", `deviceType=${opts.deviceType ?? "liteWearable"}`,
    `buildMode=${opts.buildMode ?? "debug"}`,
    `sourceMap=${opts.sourceMap ?? "none"}`
  ];

  if (opts.appResource) args.push(`appResource=${opts.appResource}`);

  const r = spawnSync(node, args, { encoding: "utf8", env, maxBuffer: 32 * 1024 * 1024 });

  const ok = (r.stdout ?? "").includes("COMPILE RESULT:SUCCESS");

  return {
    ok,
    code: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    buildDir: opts.buildDir
  };
}
