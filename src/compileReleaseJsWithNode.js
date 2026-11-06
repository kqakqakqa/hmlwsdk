import fs from "fs";
import path from "path";

import { compileJs } from "./runWebpack.js";
import { generateJsSnapshot } from "./generateJsSnapshot.js";
import { todo } from "./createTaskContext.js";

/**
 * compileReleaseJsWithNode —— node + webpack 编译
 *
 * 关键点：aceModuleRoot 必须是**组件目录**，不是模块根目录。
 *
 * 依据 ace-loader/webpack.lite.config.js 第 119 行：
 *   process.env.projectPath = env.aceModuleRoot || ... || process.cwd()
 * 然后 main.product.js 的 loadEntryObj 里检查 path.resolve(projectPath, 'app.js')
 * 存不存在，不存在就报 ERROR: missing app.js。
 *
 * 所以 Gradle 是「每个组件单独编一次」，aceModuleRoot 传的是
 * <模块>/src/main/js/<组件名>。传 src/main 会直接报 missing app.js。
 *
 * 产物仍写到模块级的 buildDir（webpack 自己按组件名展开成
 * assets/js/<组件名>/），实测产物结构与 devdemo 的
 * js/release/source/lite/assets/js/default/ 对得上。
 *
 * release 与 debug 的差别：webpack 换 mode production，代码被压缩
 * 实测（devdemo 两变体对比）：app.js 6187 → 1604，app.bc 2564 → 1812。
 */

export const name = "compileReleaseJsWithNode";
export const produces = "js/release/source/lite/assets/js/<component>/*.js|*.bc";

export async function run(taskContext) {
  if (!taskContext.paths.jsManifest) todo(name, "missing jsManifest, run generateReleaseJsManifest first");
  if (!taskContext.config) todo(name, "missing taskContext.config, run mergeReleaseProfile first");

  const components = taskContext.config.module?.js ?? [];
  if (!components.length) todo(name, "config.json has no module.js, cannot get the component names");

  const sourceRoot = path.join(taskContext.work, "js", "release", "source", "lite");

  for (const comp of components) {
    // 组件目录，下面必须有 app.js
    const moduleRoot = path.join(taskContext.moduleDir, "src", "main", "js", comp.name);
    if (!fs.existsSync(path.join(moduleRoot, "app.js"))) {
      throw new Error(`${name}: no app.js under ${moduleRoot}, check the component name ${comp.name}`);
    }

    // 每个组件有自己的一份 manifest
    const manifestPath = path.join(taskContext.work, "js", "release", "jsManifest", comp.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      todo(name, `component ${comp.name} has no manifest.json: ${manifestPath} (generateReleaseJsManifest only generates the first component)`);
    }

    // buildPath 必须带上 assets/js/<组件名> 这一层。
    // 传 source/lite 的话 webpack 会把 app.js / common/ / pages/ 直接写在根下，
    // 而 Gradle 的产物结构是 assets/js/default/app.js —— 实测差 83 个条目。
    const buildDir = path.join(sourceRoot, "assets", "js", comp.name);

    // resources 下的 png 也要转成 .bin，靠 img2bin 的 iconPath 环境变量。
    // compileReleaseResources 没跑过时这个目录不存在，就不传（不是所有调用方都需要它）。
    const resPngDir = taskContext.paths.resources ? path.join(path.dirname(taskContext.paths.resources), "resources") : null;

    const r = compileJs({
      moduleRoot,
      buildDir,
      manifestPath,
      iconPath: resPngDir && fs.existsSync(resPngDir) ? resPngDir : undefined,
      // 缓存必须放在产物目录外面。默认的 <buildDir>/../cache 会落在
      // assets/js/cache/ 下，被打进 .bin 变成多余条目（实测多出 2 个 .pack.gz）。
      cacheDir: path.join(taskContext.work, "js", "release", "cache"),
      buildMode: "release",
      deviceType: "liteWearable",
      hapMode: true
    });

    if (!r.ok) {
      throw new Error(
        `${name} failed: component ${comp.name} (webpack exited with ${r.code})\n` +
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
      throw new Error(`${name}: no .js generated under ${buildDir}, the webpack output looks wrong`);
    }
  }

  taskContext.paths.jsBuild = sourceRoot;
  return sourceRoot;
}
