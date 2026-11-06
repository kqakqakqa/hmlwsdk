import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

import { readProject } from "./readProject.js";
import { mergeProfile } from "./processConfig.js";
import { compileResources } from "./compileResources.js";
import { compileJs } from "./compileJs.js";
import { assembleAssets } from "./assembleAssets.js";
import { collectFiles } from "./collectFiles.js";
import { writeBin } from "./readWriteBin.js";
import { packBinHap, packTreeHap } from "./packHap.js";
import { packApp } from "./packApp.js";
import { signApp } from "./signApp.js";
import { prepareSigning, signBin } from "./sign/index.js";
import { readSigningConfig, CERT_DIR } from "./readSigningConfig.js";

/**
 * 整条出包链
 *
 *   读工程 → 加工 config ┬─ 编译资源 ─┬─ 组装 source/ → 写 .bin ─┬─ 签 .bin ─┐
 *                        └─ 编译 JS ──┘                          │          ├→ 打 hap（.bin 形态）→ 签 hap
 *                                                               └→ 打 hap（文件树）→ 打 .app → 签 .app
 *
 * 没有任务表、没有依赖图、没有跨步骤的 context 对象 —— 整条链 6~10 步，
 * 顺序写出来一眼能看完。
 *
 * target 决定跑到哪一步：
 *   bin        出 .bin                           （给了签名配置就顺带签）
 *   signedHap  出「里面那个 .bin 已签名」的 hap
 *   app        出 .app                           （给了签名配置就顺带签）
 *   signedApp  出签名后的 .app
 *
 * 落盘的只有一份：<工程>/build/<bundleName>.<ext>，内容是哪个由 target 决定 ——
 *   build/<bundleName>.bin   target=bin
 *   build/<bundleName>.hap   target=signedHap
 *   build/<bundleName>.app   target=app / signedApp
 * 中间产物（.bin、两种 hap、pack.info）全在内存里往后传，一行都不落盘。
 *
 * 必须落盘的只有 webpack 那几个 —— 它是独立进程，只能靠文件系统交接。
 * 这些都放在系统临时目录（work），跑完整个删掉：
 *   work/R.txt                     资源 id 表，只用来回填 config
 *   work/manifest/<组件>/           webpack 的输入
 *   work/source/                   .bin / hap 的原料树（config.json + assets/）
 *   work/pack/                     pack.info（同时打进 .app，文件这份是副产物）
 * work 放临时目录而不是工程里，工程 build/ 下就只剩那一份能直接用的产物。
 *
 * 签名材料统一从 <工程>/cert/ 读（见 readSigningConfig.js），CLI 不再传 p7b/p12。
 * 规则是「有就签、没有就不签」；target 是 signed* 时则要求必须有材料，缺了直接报错。
 *
 * 中间态一律用变量传，不落盘：资源直接写进 source/assets/entry（没有 res/ 中间目录），
 * .bin 和 hap 的 Buffer 留在内存里给下一步用，不会写完再读回来。
 * 必须落盘的只有三类 —— webpack 的输入 manifest、webpack 的输出目录、最终产物，
 * 前两个是因为 webpack 是独立进程，只能靠文件系统交接。
 */

export const TARGETS = ["bin", "signedHap", "app", "signedApp"];

/**
 * @param {object} opts
 * @param {string} [opts.projectDir] 工程目录（含 entry/ 的那一层），省略用 cwd
 * @param {string} opts.target        TARGETS 里的一个
 * @param {string} [opts.work]        scratch 目录，默认系统临时目录下按工程区分的一个子目录
 * @param {string} [opts.node]        跑 webpack 的 node，默认当前进程（正常从 hmlwsdk.config.js 来）
 * @param {object} [opts.signingConfig] 显式给签名材料，省略则读 <工程>/cert/
 * @param {(line:string)=>void} [opts.log]
 * @returns {Promise<{target:string, work:string, artifact:string}>} 
 */
export async function build(opts) {
  if (!TARGETS.includes(opts.target)) {
    throw new Error(`unknown target: ${opts.target} (expected one of ${TARGETS.join(", ")})`);
  }

  const log = opts.log ?? console.log;
  const step = makeStepTimer(log);

  // ── 读工程 + 签名材料 ────────────────────────────────────────────────
  const project = await step("read project", () => readProject(opts.projectDir));

  // 签名材料从 cert/ 读，很快（就几个文件），放在 webpack 之前 ——
  // 这样「命令要求签名但 cert/ 是空的」立刻失败，不用等 5 秒编译完才报。
  const signingConfig =
    opts.signingConfig ?? (await step("read signing", () => readSigningConfig(project.root)));

  if (opts.target.startsWith("signed") && !signingConfig) {
    throw new Error(
      `${opts.target} produces a signed artifact, but ${path.join(project.root, CERT_DIR)} has no signing material ` +
        "(drop a .p7b plus a .p12 or PKCS#8 .pem in there; the password is tried against the p12 file name if unset)"
    );
  }

  // webpack 是独立进程，只能靠文件系统交接，所以必须有这么一份 scratch。
  // 放系统临时目录而不是工程里 —— 工程 build/ 下只该有命令承诺的那一份产物。
  // 目录名带工程名 + 路径 hash：多工程不会撞，同一个工程每次都落到同一处，
  // webpack 的 cache 才能持续复用（cache 里存着 manifest 的绝对路径）。
  const work = path.resolve(
    opts.work ?? path.join(os.tmpdir(), "hmlwsdk", workKey(project.root))
  );
  const sourceRoot = path.join(work, "source");
  // 资源直接编译到这里 —— 不再有 res/ 中间目录，也就不需要「先编到 res 再拷过来」
  const assetsEntry = path.join(sourceRoot, "assets", "entry");
  const rTxtPath = path.join(work, "R.txt");
  // pack.info 的落点（它同时被打进 .app，磁盘这份是 packApp 的副产物）
  const packDir = path.join(work, "pack");
  // 唯一一份产物放这儿，命名用 bundleName —— 见文件末尾的 publish()
  const outRoot = path.join(project.root, "build");

  // mergeProfile 之后的 config 只是中间态，不落盘 —— 真正要看的是
  // source/config.json（已回填资源 id），那份在 assembleAssets 里写。
  const merged = await step("merge config", () =>
    mergeProfile(project.srcConfig, {
      compileSdkVersion: project.compileSdkVersion,
      compatibleSdkVersion: project.compatibleSdkVersion
    })
  );

  // ── 资源 ────────────────────────────────────────────────────────────
  // 直接编进 source/assets/entry，跳过「先编 res/ 再拷过来」那一步。
  // 必须先清一遍：工程删掉的资源不会自己消失，留下的旧文件会被打进 .bin。
  await step("compile resources", () => {
    fs.rmSync(assetsEntry, { recursive: true, force: true });
    return compileResources({
      moduleRoot: path.join(project.moduleDir, "src", "main"),
      moduleName: "entry",
      outDir: assetsEntry,
      rTxtPath,
      compressImage: true,
      force: true
    });
  });

  // ── JS ──────────────────────────────────────────────────────────────
  // 资源编译要先跑：compileJs 要把资源目录里的 png 也转成 .bin
  // （靠 ace-loader 的 img2bin + iconPath 环境变量，产物直接落在 resources/base/media 下）
  await step("compile js", () =>
    compileJs({
      moduleDir: project.moduleDir,
      config: merged,
      work,
      sourceRoot,
      // 用哪个 node 跑 webpack：来自 hmlwsdk.config.js，没写就是当前进程
      node: opts.node,
      iconDir: path.join(assetsEntry, "resources")
    })
  );

  // ── 收尾：定型 config + 清掉多余文件 ────────────────────────────────
  // 返回的是最终版 config：回填了 iconId / labelId、deviceType 改写成 liteWearable
  const config = await step("assemble assets", () =>
    assembleAssets({
      sourceRoot,
      config: merged,
      rTxtText: fs.readFileSync(rTxtPath, "utf8")
    })
  );

  // ── 写 .bin ─────────────────────────────────────────────────────────
  // 只在内存里出 Buffer：它要么是最终产物，要么是 hap 的内容，两种都不需要
  // 中间那份文件。
  const unsignedBinBuf = await step("write bin", () =>
    writeBin({ bundleName: config.app.bundleName, entries: collectFiles(sourceRoot) })
  );

  // cert/ 里没材料时不签，unsigned 直接当 signed 往下传
  let binForHap = unsignedBinBuf;
  let binForHapName = "entry-release-unsigned.bin";
  if (signingConfig) {
    binForHapName = "entry-release-signed.bin";
    binForHap = await step("sign bin", () => signBinBuffer(unsignedBinBuf, signingConfig));
  }

  // 收尾：把唯一一份产物放到 build/ 根、清掉 scratch、返回它的路径。
  // 四个 target 都从这里出去，所以「只落一份」这件事只有一个实现点。
  const done = (buf, ext) => {
    const artifact = publish(buf, outRoot, config.app.bundleName, ext);
    if (!signingConfig) {
      log(`! no signing material in ${CERT_DIR}/, ${path.basename(artifact)} is unsigned and cannot be installed on a watch`);
    }
    cleanWork(work);
    return { target: opts.target, work, artifact };
  };

  if (opts.target === "bin") return done(binForHap, ".bin");

  // ── .bin 形态的 hap ─────────────────────────────────────────────────
  // 设备直接装的就是这种（里面只有那一个 .bin）。它进不了 .app，所以只有
  // target=signedHap 时才是产物，其它 target 下打完就扔 —— Buffer 而已。
  // 原来的实现是「打成 hap → 拆开读出 .bin → 判断已签 → 装回去」，那个拆包
  // 一步纯属白做：hap 就是把 .bin 塞进 zip，Buffer 直接拿来打就行。
  const binHap = await step("pack bin hap", () => packBinHap(binForHap, binForHapName));

  if (opts.target === "signedHap") {
    // 不往 hap 的 zip 里插 "HAP Sig Block 42" —— 设备验的是 .bin 自己的签名块，
    // 那层块没有验证价值。
    return done(binHap, ".hap");
  }

  // 文件树形态：.bin 形态进不了 .app（PackageApp 会过滤文件名含 -bin- 的）
  const treeHapBuf = await step("pack tree hap", () => packTreeHap(sourceRoot, config));

  // hapName 传 .app 里的名字：去掉了 "-unsigned"（实测 Gradle 产物就是这样）
  const appBuf = await step(
    "pack app",
    () => packApp({ outDir: packDir, hapBuf: treeHapBuf, hapName: "entry-release-lite.hap", config }).appBuf
  );

  // 两个停止点 × cert/ 里有没有签名材料，所以 buildApp 有材料也会往下签，
  // 与 buildBin 的行为一致
  const finalApp = signingConfig
    ? await step("sign app", () => signApp({ appBuf, signingConfig }))
    : appBuf;

  return done(finalApp, ".app");
}

/**
 * 把唯一一份产物写到 <工程>/build/ 根，文件名用 bundleName
 *
 * 中间产物一个都不留，所以这里不需要「挑哪个是给人用的」—— 进来的就是答案。
 * 顺手删掉同 bundleName 的其它形态（.app / .hap / .bin）：那是上一次别的 target
 * 留下的，留着会让人装到旧包。
 */
function publish(buf, outRoot, bundleName, ext) {
  const dest = path.join(outRoot, `${bundleName}${ext}`);
  fs.mkdirSync(outRoot, { recursive: true });
  for (const other of [".app", ".hap", ".bin"]) {
    if (other !== ext) fs.rmSync(path.join(outRoot, `${bundleName}${other}`), { force: true });
  }
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * scratch 目录名：工程名 + 路径 hash
 *
 * 同一个工程每次都要落到同一处 —— webpack 的 cache 里存着 manifest 的绝对路径，
 * 换个目录就拿到陈旧缓存、报 Module not found（见 runWebpack.js 的 cachePath 注释）。
 */
function workKey(projectRoot) {
  const base = path.basename(projectRoot).replace(/[^\w.-]+/g, "_") || "project";
  const hash = createHash("sha256").update(projectRoot.toLowerCase()).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

/**
 * 删掉整个 scratch
 *
 * 里面只有 source / manifest / R.txt / pack，每次构建都会重写，留着没意义。
 * runWebpack 虽然传了 cachePath=<work>/cache，但这份 ace-loader 的配置并不读它
 * （webpack.lite.config.js 里没有任何 cache 相关代码），实测连跑两次都是 3 s、
 * work 下从来没出现过 cache 目录 —— 所以没有需要挑着留下的东西。
 */
function cleanWork(work) {
  fs.rmSync(work, { recursive: true, force: true });
}

/**
 * 给 .bin 签名，返回签名后的 Buffer
 * 签名格式见 sign/signBin.js
 */
function signBinBuffer(unsignedBuf, signingConfig) {
  const signing = prepareSigning(signingConfig);

  return signBin({
    unsignedBin: unsignedBuf,
    p7b: signing.p7b,
    keyPem: signing.keyPem,
    certPems: signing.certPems,
    signTime: signing.signTime
  });
}

/**
 * 每步打一行耗时，失败时把步骤名补进错误信息
 * 不加这一步的话，webpack 报错只会在几十行 stderr 里翻，看不出是哪一步
 */
function makeStepTimer(log) {
  return async function step(name, fn) {
    const t0 = Date.now();
    try {
      const r = await fn();
      log(`✓ ${name.padEnd(22)} ${String(Date.now() - t0).padStart(6)} ms`);
      return r;
    } catch (e) {
      log(`✗ ${name.padEnd(22)} ${String(Date.now() - t0).padStart(6)} ms  ${String(e.message).split("\n")[0]}`);
      throw new Error(`${name}: ${e.message}`, { cause: e });
    }
  };
}
