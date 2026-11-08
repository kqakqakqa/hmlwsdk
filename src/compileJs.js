import fs from "fs";
import path from "path";

import { runWebpack } from "./runWebpack.js";
import { generateJsSnapshot } from "./generateJsSnapshot.js";

/**
 * 编译 JS：每个组件各跑一次 webpack，再把 .js 编成 .bc
 *
 * 对 config.json 的 module.js 里每个组件做四件事：
 *   1. 按 component 拼出 webpack 要的 manifest.json
 *   2. node + webpack 编译
 *   3. 删掉 webpack 的中间文件
 *   4. .js → .bc（jerry-snapshot 的 wasm 版，进程内跑）
 *
 * 为什么 manifest 不单独产出成一份中间产物：
 * 它每个字段都是直接从 config.json 取的（appID 取 bundleName、pages 取 module.js[].pages、
 * minPlatformVersion 取 apiVersion.compatible），落成文件只是为了让 webpack 能按路径读。
 * 之前那一步只生成第一个组件的 manifest，而这里要循环所有组件，两边对不上 ——
 * 合成一步之后每个组件自己拼自己的。
 *
 * ⚠ aceModuleRoot 必须是**组件目录**，不是模块根目录。
 * 依据 ace-loader/webpack.lite.config.js 第 119 行：
 *   projectPath = env.aceModuleRoot || ... || process.cwd()
 * 然后 main.product.js 的 loadEntryObj 里检查 path.resolve(projectPath, 'app.js')
 * 存不存在，不存在就报 ERROR: missing app.js。
 * 所以每个组件要「单独编一次」，传 src/main 会直接报 missing app.js。
 *
 * release 与 debug 的差别：webpack 换 mode production，代码被压缩
 * 实测（devdemo 两变体对比）：app.js 6187 → 1604，app.bc 2564 → 1812。
 */

/**
 * @param {object} opts
 * @param {string} opts.moduleDir   entry 模块目录
 * @param {object} opts.config      加工过的 config（需要 module.js / app / module.deviceType）
 * @param {string} opts.work        work 目录，manifest 和 webpack 缓存写在这下面
 * @param {string} opts.sourceRoot  webpack 的产物根，会写成 sourceRoot/assets/js/<组件>/
 * @param {string} [opts.node]      跑 webpack 用哪个 node，默认由 runWebpack 自己探
 * @param {string} [opts.iconDir]   资源编译产出的 resources/ 目录，有的话把里面的 png 也转成 .bin
 * @param {(name:string, fn:Function)=>Promise} [opts.step] 子步骤计时器，由 build.js 传入
 * @returns {Promise<string>} sourceRoot
 */
export async function compileJs(opts) {
  const components = opts.config.module?.js ?? [];
  if (!components.length) {
    throw new Error("config.json has no module.js, cannot get the component names");
  }

  // 这一步实测 3~5.5 s，整段一个数字看不出东西花在哪儿，所以内部再分四段。
  // 单独调用时不传 step，直通。
  // 实测（2026-11）：
  //   devdemo  release 25 个页面：manifest 3 ms / webpack 5187 ms / clean 1 ms / snapshot 249 ms
  //   _empty   release 空工程：   manifest 2 ms / webpack 3040 ms / clean 1 ms / snapshot  38 ms
  // 空工程也要 3 s，说明 webpack 那一段的大头是固定开销而不是转译量：
  // 实测 node 裸启动 75 ms、require('webpack') 550 ms、再 require 到 webpack.lite.config.js
  // 共约 1.1 s，剩下的才是 babel 转译 + terser + 落盘。
  // 想再往下拆只能靠 webpack 的 --profile，实测那套数字不可用
  // （98 个模块的 building 累加 77 s，总时长才 5.2 s：loader 链嵌套计时）
  const sub = opts.step ?? (async (_name, fn) => fn());

  // webpack 的阶段时间戳是**边跑边**从 stderr 回来的（measureWebpack.cjs），
  // 这里转成树的一行：d 是相对 webpack 的层级，1 是 compile js 的子行，所以整体 +1。
  // 计时器是直通函数时（库调用方没传 step）没有 title/detail/total，明细直接丢掉。
  const onTiming =
    typeof sub.title === "function"
      ? (event) => {
          const depth = 1 + (event.d ?? 0);
          if (event.t === "title") sub.title(depth, event.name);
          else if (event.t === "detail") sub.detail(depth, event.name, event.ms, event.w);
          else if (event.t === "total") sub.total(depth, event.name, event.ms);
        }
      : undefined;

  for (const comp of components) {
    const moduleRoot = path.join(opts.moduleDir, "src", "main", "js", comp.name);
    if (!fs.existsSync(path.join(moduleRoot, "app.js"))) {
      throw new Error(`no app.js under ${moduleRoot}, check the component name ${comp.name}`);
    }

    const manifestPath = await sub("manifest", () =>
      writeManifest(opts.config, comp, path.join(opts.work, "manifest", comp.name))
    );

    // buildDir 必须带上 assets/js/<组件名> 这一层。
    // 传 sourceRoot 的话 webpack 会把 app.js / common/ / pages/ 直接写在根下，
    // 而 Gradle 的产物结构是 assets/js/default/app.js —— 实测差 83 个条目。
    const buildDir = path.join(opts.sourceRoot, "assets", "js", comp.name);

    // webpack 这一步单独计时，不走 sub()：它的标题和明细是 webpack 自己边跑边
    // 通过 onTiming 吐出来的（见 measureWebpack.cjs），sub() 那种「跑完打一行」
    // 打不出「标题 → 明细 → 总时间」这个层次，也让那 5 s 里终端一片空白。
    const tWebpack = Date.now();
    const r = await runWebpack({
      moduleRoot,
      buildDir,
      manifestPath,
      // 用哪个 node 跑 webpack。给了就用（来自 hmlwsdk.config.js 的 node），
      // 没给由 runWebpack 自己探（process.execPath 优先）
      node: opts.node,
      // resources 下的 png 也要转成 .bin，靠 img2bin 的 iconPath 环境变量。
      // 资源编译没跑过时这个目录不存在，就不传。
      iconPath: opts.iconDir && fs.existsSync(opts.iconDir) ? opts.iconDir : undefined,
      // 缓存必须放在产物目录外面。默认的 <buildDir>/../cache 会落在
      // assets/js/cache/ 下，被打进 .bin 变成多余条目（实测多出 2 个 .pack.gz）。
      cacheDir: path.join(opts.work, "cache"),
      buildMode: "release",
      deviceType: "liteWearable",
      hapMode: true,
      onTiming
    });
    const webpackMs = Date.now() - tWebpack;

    if (!r.ok) {
      throw new Error(
        `webpack failed for component ${comp.name} (exit ${r.code})\n` +
          (r.stderr ?? "").slice(-2000) +
          "\n" +
          (r.stdout ?? "").slice(-2000)
      );
    }

    // webpack 的总时长要等子进程退出才算得准，所以它自己不打这一行，由这里补
    sub.total?.(1, "webpack", webpackMs);

    // 清掉 webpack 的中间文件 —— Gradle 的 92 个产物里没有这些。
    // 实测 devdemo 会多出 image_convert_result.txt、preview_css.json、_releaseMap/。
    await sub("clean output", () => {
      for (const junk of ["image_convert_result.txt", "preview_css.json"]) {
        fs.rmSync(path.join(buildDir, junk), { force: true });
      }
      fs.rmSync(path.join(buildDir, "_releaseMap"), { recursive: true, force: true });
    });

    // webpack 只出 .js，真机要的 .bc 在这里补。
    // ace-loader 的 SnapshotPlugin（exec Windows 专属 exe 的那个）已经被
    // --isPreview=true 关掉，换成进程内的 jerry-parser-wasm。
    // 实测（devdemo debug 22 个文件）397 ms，平均 18 ms/个，比每次 exec 起进程还快。
    const snapped = await sub("snapshot", () => generateJsSnapshot(buildDir));
    if (!snapped.count) {
      throw new Error(`no .js generated under ${buildDir}, the webpack output looks wrong`);
    }
  }

  return opts.sourceRoot;
}

/**
 * 写 webpack 要的 manifest.json
 *
 * 实测内容（apps/_empty/_empty，4 空格缩进、末尾无换行）：
 *   {
 *       "appID": "com.github.kqakqakqa.hmlitewearable._empty",
 *       "appName": "$string:appName",
 *       "versionName": "0.1.0",
 *       "versionCode": 1,
 *       "minPlatformVersion": 3,
 *       "pages": ["pages/index/index"],
 *       "deviceType": ["liteWearable"]
 *   }
 *
 * 注意 appName 保留 "$string:appName" 原样，webpack 侧才去解析资源引用，
 * 这里不做替换。
 */
function writeManifest(config, comp, outDir) {
  const manifest = {
    appID: config.app.bundleName,
    appName: comp.name === "default" ? "$string:appName" : `$string:${comp.name}_appName`,
    versionName: config.app.version.name,
    versionCode: config.app.version.code,
    minPlatformVersion: config.app.apiVersion.compatible,
    pages: comp.pages,
    deviceType: config.module.deviceType
  };

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "manifest.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 4));
  return out;
}
