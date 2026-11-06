import fs from "fs";
import path from "path";

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

/**
 * 整条出包链
 *
 *   读工程 → 加工 config ┬─ 编译资源 ─┬─ 组装 source/ → 写 .bin ─┬─ 签 .bin ─┐
 *                        └─ 编译 JS ──┘                          │          ├→ 打 hap（.bin 形态）→ 签 hap
 *                                                               └→ 打 hap（文件树）→ 打 .app → 签 .app
 *
 * 没有任务表、没有依赖图、没有跨步骤的 context 对象 —— 这些在 Gradle 里是为了
 * 声明式地拼装 100 多个 task 才需要的，这里整条链 6~10 步，顺序写出来一眼能看完。
 *
 * target 决定跑到哪一步：
 *   bin        出 .bin                           （给了签名配置就顺带签）
 *   signedHap  出「里面那个 .bin 已签名」的 hap
 *   app        出 .app                           （给了签名配置就顺带签）
 *   signedApp  出签名后的 .app
 *
 * work 目录布局（不像 Gradle 那样逐层对应 build/，只留真正用的）：
 *   work/R.txt                     资源 id 表，只用来回填 config，不进包
 *   work/manifest/<组件>/           webpack 的输入
 *   work/cache/                     webpack 缓存
 *   work/source/                    .bin 的原料树（config.json + assets/）
 *   work/bin/                       *.bin
 *   work/hap/                       *.hap
 *   work/app/                       *.app + pack.info
 *
 * 中间态一律用变量传，不落盘：资源直接写进 source/assets/entry（没有 res/ 中间目录），
 * .bin 和 hap 的 Buffer 留在内存里给下一步用，不会写完再读回来。
 * 必须落盘的只有三类 —— webpack 的输入 manifest、webpack 的输出目录、最终产物，
 * 前两个是因为 webpack 是独立进程，只能靠文件系统交接。
 */

export const TARGETS = ["bin", "signedHap", "app", "signedApp"];

/**
 * @param {object} opts
 * @param {string} opts.projectDir    工程目录（含 entry/ 的那一层）
 * @param {string} opts.target        TARGETS 里的一个
 * @param {string} [opts.work]        中间产物目录，默认 <工程>/build/hmlwsdk
 * @param {object} [opts.signingConfig] { p7b, p12?, password?, keyFile?, certPath? }
 * @param {(line:string)=>void} [opts.log]
 * @returns {Promise<object>} 各阶段产物的路径
 */
export async function build(opts) {
  if (!TARGETS.includes(opts.target)) {
    throw new Error(`unknown target: ${opts.target} (expected one of ${TARGETS.join(", ")})`);
  }
  if (opts.target.startsWith("signed") && !opts.signingConfig) {
    throw new Error(`${opts.target} produces a signed artifact, but no signing config was given`);
  }

  const log = opts.log ?? console.log;
  const step = makeStepTimer(log);

  // ── 读工程 + 加工 config ──────────────────────────────────────────────
  const project = await step("read project", () => readProject(opts.projectDir));

  const work = path.resolve(opts.work ?? path.join(project.root, "build", "hmlwsdk"));
  const sourceRoot = path.join(work, "source");
  // 资源直接编译到这里 —— 不再有 res/ 中间目录，也就不需要「先编到 res 再拷过来」
  const assetsEntry = path.join(sourceRoot, "assets", "entry");
  const rTxtPath = path.join(work, "R.txt");
  const binDir = path.join(work, "bin");
  const hapDir = path.join(work, "hap");
  const appDir = path.join(work, "app");

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
  // Buffer 留着给下一步打 hap，不从磁盘读回来
  const binName = "entry-release-unsigned.bin";
  const unsignedBinBuf = await step("write bin", () => {
    const buf = writeBin({ bundleName: config.app.bundleName, entries: collectFiles(sourceRoot) });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, binName), buf);
    return buf;
  });

  const outputs = { target: opts.target, work, bin: path.join(binDir, binName) };

  // 没给签名配置时走 Gradle 的默认路径：不签，unsigned 直接当 signed 往下传
  let binForHap = unsignedBinBuf;
  let binForHapName = binName;
  if (opts.signingConfig) {
    binForHapName = "entry-release-signed.bin";
    binForHap = await step("sign bin", () => signBinFile(unsignedBinBuf, path.join(binDir, binForHapName), opts.signingConfig));
    outputs.signedBin = path.join(binDir, binForHapName);
  }

  if (opts.target === "bin") return outputs;

  // ── 两种 hap ────────────────────────────────────────────────────────
  fs.mkdirSync(hapDir, { recursive: true });

  // ── .bin 形态的 hap ─────────────────────────────────────────────────
  // 设备直接装的就是这种（里面只有那一个 .bin）。不管后面出不出 .app 都要，
  // 所以两种 target 共用同一份 Buffer。
  // 原来的实现是「打成 hap → 拆开读出 .bin → 判断已签 → 装回去」，那个拆包
  // 一步纯属白做：hap 就是把 .bin 塞进 zip，Buffer 直接拿来打就行。
  const binHap = await step("pack bin hap", () => {
    const buf = packBinHap(binForHap, binForHapName);
    fs.writeFileSync(path.join(hapDir, "entry-bin-release-lite-unsigned.hap"), buf);
    return buf;
  });
  outputs.binHap = path.join(hapDir, "entry-bin-release-lite-unsigned.hap");

  if (opts.target === "signedHap") {
    // 与 Gradle 的差别：不往 hap 的 zip 里插 "HAP Sig Block 42"。设备验的是
    // .bin 自己的签名块，那层块没有验证价值。所以这里只是换个名字存一份。
    const signed = path.join(hapDir, "entry-bin-release-lite-signed.hap");
    fs.writeFileSync(signed, binHap);
    outputs.hap = signed;
    return outputs;
  }

  // 文件树形态：.bin 形态进不了 .app（PackageApp 会过滤文件名含 -bin- 的）
  const treeHapPath = path.join(hapDir, "entry-release-lite-unsigned.hap");
  const treeHapBuf = await step("pack tree hap", () => {
    const buf = packTreeHap(sourceRoot, config);
    fs.writeFileSync(treeHapPath, buf);
    return buf;
  });
  outputs.treeHap = treeHapPath;

  // hapName 传 .app 里的名字：去掉了 "-unsigned"（实测 Gradle 产物就是这样）
  const { appBuf, appPath } = await step("pack app", () =>
    packApp({ outDir: appDir, hapBuf: treeHapBuf, hapName: "entry-release-lite.hap", config })
  );
  outputs.app = appPath;

  // 四条命令 = 两个停止点 × 有没有签名配置，所以 buildApp 带了 --p7b 也会往下签，
  // 与 buildBin 的行为一致（Gradle 那边没配 signingConfig 就出 unsigned）
  if (!opts.signingConfig) return outputs;

  outputs.signedApp = await step("sign app", () => {
    const buf = signApp({ appBuf, signingConfig: opts.signingConfig });
    const out = appPath.replace("-unsigned", "-signed");
    fs.writeFileSync(out, buf);
    return out;
  });
  return outputs;
}

/**
 * 给 .bin 签名并落盘，把签名后的 Buffer 一起返回给打 hap 用
 * 签名格式见 sign/signBin.js
 */
function signBinFile(unsignedBuf, outPath, signingConfig) {
  const signing = prepareSigning(signingConfig);

  const signed = signBin({
    unsignedBin: unsignedBuf,
    p7b: signing.p7b,
    keyPem: signing.keyPem,
    certPems: signing.certPems,
    signTime: signing.signTime
  });

  fs.writeFileSync(outPath, signed);
  return signed;
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
