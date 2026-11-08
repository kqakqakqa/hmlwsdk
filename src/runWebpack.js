import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { resolveTools, resolveNode } from "./findTools.js";

/** 计时壳。webpack 4 只认 CommonJS 配置，所以它是 .cjs，见该文件头注释 */
const TIMING_CONFIG = fileURLToPath(new URL("./measureWebpack.cjs", import.meta.url));

/** measureWebpack.cjs 把每个阶段的时间戳按这个前缀打到 stderr，一行一个 JSON */
const TIMING_PREFIX = "HMLWSDK_TIMING:";

/**
 * 跑一次 webpack —— 只负责 spawn，不管 manifest、不管 .bc、不管清理
 *
 * 完整的「编译 JS」这一步在 compileJs.js，它对每个组件调一次这里。
 *
 * 实测命令（apps/_empty/_empty）：
 *   node --openssl-legacy-provider <ace-loader>/node_modules/webpack/bin/webpack.js
 *        --config <SDK>/src/measureWebpack.cjs
 *        --deviceType=liteWearable --buildMode=release --sourceMap=none --isPreview=true
 *   环境变量：aceModuleRoot / aceModuleBuild / aceManifestPath / watchMode / hapMode
 *             HMLWSDK_ACE_CONFIG=<ace-loader>/webpack.lite.config.js
 *
 * ⚠ --config 指的不是 ace-loader 的配置，而是本 SDK 的计时壳。壳里 require
 *   HMLWSDK_ACE_CONFIG 指向的那份、原样调用、只多 push 一个计时插件 ——
 *   路径解析全在壳里那份配置的 __dirname 下做，所以产物路径不受影响
 *   （实测产物字节一致：_empty 的 .app 27749 B 与不装壳时相同）。
 *
 * ⚠ aceModuleRoot 必须是**组件目录**，例如 <模块>/src/main/js/default，不是 src/main。
 *   依据 webpack.lite.config.js 第 119 行：
 *     projectPath = env.aceModuleRoot || process.env.aceModuleRoot || cwd
 *   而 main.product.js 的 loadEntryObj 会检查 <projectPath>/app.js 是否存在，
 *   不存在就报 "ERROR: missing app.js"。所以每个组件要各调一次 webpack。
 *
 * 实测耗时：首次 59 s（webpack cache 为空），第二次 1.76 s。
 * devdemo（25 个页面）release 一次约 5 s，其中真正编模块约 2.4 s，
 * 其余是 webpack/babel/postcss 这些库的加载 —— 明细由 timing 返回，见 measureWebpack.cjs。
 *
 * 注意：webpack.lite.config.js 第 138 行会 deleteFolderRecursive(buildPath)，
 * 所以 opts.buildDir 必须是专用目录，不要指到别的产物目录上。
 *
 * @param {object} opts
 * @param {(event:{t:string,d:number,name:string,ms?:number})=>void} [opts.onTiming]
 *   每个阶段结束时回调一次（事件格式见 measureWebpack.cjs），用于边跑边打进度
 * @returns {Promise<{ok:boolean, code:number, stdout:string, stderr:string, buildDir:string}>}
 *   ⚠ 是 Promise：子进程用 spawn 流式跑（见下），不再是 spawnSync
 */
export function runWebpack(opts) {
  const tools = opts.tools ?? resolveTools();
  const node = opts.node ?? resolveNode();

  const webpackBin = path.join(tools.aceLoader, "node_modules", "webpack", "bin", "webpack.js");
  const webpackConfig = path.join(tools.aceLoader, "webpack.lite.config.js");

  if (!fs.existsSync(webpackBin)) throw new Error(`webpack not found: ${webpackBin}`);
  if (!fs.existsSync(webpackConfig)) throw new Error(`webpack config not found: ${webpackConfig}`);

  fs.mkdirSync(opts.buildDir, { recursive: true });

  const env = {
    ...process.env,
    aceModuleRoot: opts.moduleRoot,
    aceModuleBuild: opts.buildDir,
    aceManifestPath: opts.manifestPath,
    watchMode: "false",
    buildMode: opts.buildMode ?? "debug",
    hapMode: opts.hapMode ? "true" : "false",
    // webpack.lite.config.js 第 121 行：cachePath 默认是 ace-loader/node_modules/.cache，
    // 实际缓存目录是 <cachePath>/.lite_cache。
    // 这个缓存里存了 manifest 的绝对路径，换一个输出目录就会报
    //   Module not found: Can't resolve '<旧路径>/manifest.json'
    // 所以必须把缓存绑到输出目录旁边，跟输出一起生灭。
    // 不设这个变量，第二次换 work 目录构建就会拿到陈旧缓存、编译失败。
    cachePath: opts.cacheDir ?? path.join(path.dirname(opts.buildDir), "cache"),
    // 计时壳靠它找到真正要跑的配置
    HMLWSDK_ACE_CONFIG: webpackConfig,
    // iconPath：lite-image-coverter-plugin.js 里
    //   "" !== iconPath && getDir(iconPath).forEach(img2bin)
    // 设了它才会把该目录下的 png 也转成 .bin。用它把资源目录里的
    // icon.png 转成 assets/entry/resources/base/media/icon.bin。
    // 注意 img2bin 会同时写 xxx.bin 和 xxx.png.bin 两份，后者要过滤掉。
    ...(opts.iconPath ? { iconPath: opts.iconPath } : {})
  };

  const dev = opts.deviceType ?? "liteWearable";
  const mode = opts.buildMode ?? "debug";
  const sm = opts.sourceMap ?? "none";

  const args = [
    "--openssl-legacy-provider",
    webpackBin,
    "--config", TIMING_CONFIG,
    // api6 的 webpack.lite.config.js 读的是 argv.xxx（第 130-143 行）：
    //   if (argv.deviceType) ... / if (argv.sourceMap === 'none') / if (argv.buildMode === 'release')
    // 所以必须传**直接参数**，不能传 --env。传 --env 只会进 env 对象，
    // argv.buildMode 永远是 undefined → mode 停在 development、产物不压缩
    // （实测 app.js 8195 B，gradle 的是 1604 B）。
    `--deviceType=${dev}`,
    `--buildMode=${mode}`,
    `--sourceMap=${sm}`,
    // 关掉 ace-loader 内建的 SnapshotPlugin —— 它 exec 的是 Windows 专属的
    // jerry-snapshot.exe。依据 webpack.lite.config.js 第 144 行：
    //   if (argv.isPreview !== "true") { webpackConfig.plugins.push(new SnapshotPlugin(...)) }
    // .bc 改由本 SDK 自己用 jerry-parser-wasm 生成，见 src/generateJsSnapshot.js。
    "--isPreview=true",
    // api7 的配置读的是 env.xxx，两个都传，谁用谁取
    "--env", `deviceType=${dev}`,
    "--env", `buildMode=${mode}`,
    "--env", `sourceMap=${sm}`
  ];

  if (opts.appResource) args.push("--env", `appResource=${opts.appResource}`);

  // ⚠ cwd 必须是 ace-loader 目录。
  // Babel 7 的 babel.config.js 是「root 配置」，只从 cwd 往上找。
  // 不设 cwd 的话，它会去 hmlwsdk 根目录找，找不到就静默不转译 ——
  // 结果是产物里没有 "use strict"、没有被 babel 处理过的模块，
  // 模块 ID 也跟着错位（实测 app.js 少 2 字节、index.js 少 414 字节）。
  //
  // 用 spawn 而不是 spawnSync：webpack 一次要跑 5 s，计时壳是边跑边往 stderr
  // 打阶段时间戳的，spawnSync 会把子进程的 stderr 整个攒到退出才交给父进程，
  // 那 5 s 里终端一片空白 —— 计时也就失去了「让人看到卡在哪」的意义。
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { env, cwd: tools.aceLoader });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    let stdout = "";
    // 只收**非计时**的 stderr —— 计时事件是给 onTiming 的，不该混进报错信息
    let stderr = "";
    let partial = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      partial += chunk;
      const lines = partial.split(/\r?\n/);
      // 最后一段可能是不完整的半行，留到下一个 chunk 再拼
      partial = lines.pop() ?? "";
      for (const line of lines) readStderrLine(line);
    });

    function readStderrLine(line) {
      if (!line.startsWith(TIMING_PREFIX)) {
        stderr += line + "\n";
        return;
      }
      let event;
      try {
        event = JSON.parse(line.slice(TIMING_PREFIX.length));
      } catch {
        return; // 半行/坏行直接丢，计时不该让构建失败
      }
      opts.onTiming?.(event);
    }

    child.on("error", (e) => reject(new Error(`cannot start ${node}: ${e.message}`, { cause: e })));

    child.on("close", (code) => {
      if (partial) readStderrLine(partial);
      resolve({
        ok: stdout.includes("COMPILE RESULT:SUCCESS"),
        code: code ?? -1,
        stdout,
        stderr,
        buildDir: opts.buildDir
      });
    });
  });
}
