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
 * 所以 Gradle 是「每个组件单独编一次」，传 src/main 会直接报 missing app.js。
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
 * @param {string} [opts.iconDir]   资源编译产出的 resources/ 目录，有的话把里面的 png 也转成 .bin
 * @returns {Promise<string>} sourceRoot
 */
export async function compileJs(opts) {
  const components = opts.config.module?.js ?? [];
  if (!components.length) {
    throw new Error("config.json has no module.js, cannot get the component names");
  }

  for (const comp of components) {
    const moduleRoot = path.join(opts.moduleDir, "src", "main", "js", comp.name);
    if (!fs.existsSync(path.join(moduleRoot, "app.js"))) {
      throw new Error(`no app.js under ${moduleRoot}, check the component name ${comp.name}`);
    }

    const manifestPath = writeManifest(opts.config, comp, path.join(opts.work, "manifest", comp.name));

    // buildDir 必须带上 assets/js/<组件名> 这一层。
    // 传 sourceRoot 的话 webpack 会把 app.js / common/ / pages/ 直接写在根下，
    // 而 Gradle 的产物结构是 assets/js/default/app.js —— 实测差 83 个条目。
    const buildDir = path.join(opts.sourceRoot, "assets", "js", comp.name);

    const r = runWebpack({
      moduleRoot,
      buildDir,
      manifestPath,
      // resources 下的 png 也要转成 .bin，靠 img2bin 的 iconPath 环境变量。
      // 资源编译没跑过时这个目录不存在，就不传。
      iconPath: opts.iconDir && fs.existsSync(opts.iconDir) ? opts.iconDir : undefined,
      // 缓存必须放在产物目录外面。默认的 <buildDir>/../cache 会落在
      // assets/js/cache/ 下，被打进 .bin 变成多余条目（实测多出 2 个 .pack.gz）。
      cacheDir: path.join(opts.work, "cache"),
      buildMode: "release",
      deviceType: "liteWearable",
      hapMode: true
    });

    if (!r.ok) {
      throw new Error(
        `webpack failed for component ${comp.name} (exit ${r.code})\n` +
          (r.stderr ?? "").slice(-2000) +
          "\n" +
          (r.stdout ?? "").slice(-2000)
      );
    }

    // 清掉 webpack 的中间文件 —— Gradle 的 92 个产物里没有这些。
    // 实测 devdemo 会多出 image_convert_result.txt、preview_css.json、_releaseMap/。
    for (const junk of ["image_convert_result.txt", "preview_css.json"]) {
      fs.rmSync(path.join(buildDir, junk), { force: true });
    }
    fs.rmSync(path.join(buildDir, "_releaseMap"), { recursive: true, force: true });

    // webpack 只出 .js，真机要的 .bc 在这里补。
    // ace-loader 的 SnapshotPlugin（exec Windows 专属 exe 的那个）已经被
    // --isPreview=true 关掉，换成进程内的 jerry-parser-wasm。
    // 实测（devdemo debug 22 个文件）397 ms，平均 18 ms/个，比每次 exec 起进程还快。
    const snapped = await generateJsSnapshot(buildDir);
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
