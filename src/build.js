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
 * 落盘的只有一份，内容是哪个由 target 决定 ——
 *   build/<bundleName>-<moduleName>[-signed].bin   target=bin
 *   build/<bundleName>[-signed].hap                target=signedHap
 *   build/<bundleName>[-signed].app                target=app / signedApp
 * 签过的才带 -signed，所以文件名本身就说明这个包能不能直接装表。
 * 名字带不带模块名看「这份产物代表谁」，不看后缀：.bin 是模块级产物，带模块名；
 * `.bin` 形态的 hap 和 `.app` 装的都是整个应用，所以只写包名。
 * 容器里的条目不算产物名 —— `.bin` 形态 hap 里那个唯一条目、`.app` 里那份文件树 hap
 * 都还是模块级的，名字照样带模块名。
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

  // 说的是「凑不齐可用配置」而不是「没有材料」：init 会把 cert/default.p12 放进去，
  // 常见情形是私钥已经在、只差 p7b，报「no signing material」会让人以为目录是空的。
  if (opts.target.startsWith("signed") && !signingConfig) {
    throw new Error(
      `${opts.target} produces a signed artifact, but ${path.join(project.root, CERT_DIR)} has no usable signing config — ` +
        "it needs a .p7b profile plus a .p12 or PKCS#8 .pem key. " +
        "A profile is issued per app by AppGallery Connect, it cannot be generated locally; " +
        "the p12 password is tried against the file name when cert/signing.config.js does not set one"
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
  // 唯一一份产物放这儿，命名规则见下面的「产物命名」那一段 —— 见文件末尾的 publish()
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
      iconDir: path.join(assetsEntry, "resources"),
      // 这一步动辄 5 s 以上，内部再分四段计时（manifest / webpack / clean / snapshot）
      step: step.child
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

  // ── 产物命名 ────────────────────────────────────────────────────────
  // 名字带不带模块名，看「这份产物代表谁」：
  //   模块级    build/<bundleName>-<moduleName>[-signed].bin   只有 .bin
  //   整个应用  build/<bundleName>[-signed].hap               .bin 形态的 hap
  //   整个应用  build/<bundleName>[-signed].app               .app
  // moduleName 取 config 里的 distro.moduleName（DevEco 生成的工程都有，值就是 entry）。
  // 容器里的条目不算产物名：.bin 形态 hap 里那个唯一条目、.app 里那份文件树 hap
  // 都是模块级的，名字照样带模块名，由下面的 binForHapName 和 packApp 那一步决定。
  const moduleName = config.module?.distro?.moduleName ?? "entry";
  const binStem = `${config.app.bundleName}-${moduleName}`;
  const appStem = config.app.bundleName;

  // cert/ 里没材料时不签，unsigned 直接当 signed 往下传
  let binForHap = unsignedBinBuf;
  let binForHapName = `${binStem}.bin`;
  if (signingConfig) {
    binForHapName = `${binStem}-signed.bin`;
    binForHap = await step("sign bin", () => signBinBuffer(unsignedBinBuf, signingConfig));
  }

  // 收尾：把唯一一份产物放到 build/ 根、清掉 scratch、返回它的路径。
  // 四个 target 都从这里出去，所以「只落一份」这件事只有一个实现点。
  const done = (buf, ext) => {
    // 只有 .bin 是模块级；.hap（.bin 形态）和 .app 装的都是整个应用
    const stem = ext === ".bin" ? binStem : appStem;
    const artifact = publish(buf, outRoot, stem, ext, Boolean(signingConfig), [binStem, appStem]);

    if (!signingConfig) {
      log(`! no usable signing config in ${CERT_DIR}/, ${path.basename(artifact)} is unsigned and cannot be installed on a watch`);
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

  // .app 里那个 hap 用 binStem —— pack.info 的 packages[].name 由它去后缀得来，
  // 所以这一个名字同时决定 zip 条目名和 pack.info 里的 name。
  // 它本身不带 -signed：.app 里的 hap 从不单独签，签名在 .app 自己的 zip 层。
  const appBuf = await step(
    "pack app",
    () => packApp({ outDir: packDir, hapBuf: treeHapBuf, hapName: `${binStem}.hap`, config }).appBuf
  );

  // 两个停止点 × cert/ 里有没有签名材料，所以 buildApp 有材料也会往下签，
  // 与 buildBin 的行为一致
  const finalApp = signingConfig
    ? await step("sign app", () => signApp({ appBuf, signingConfig }))
    : appBuf;

  return done(finalApp, ".app");
}

/**
 * 把唯一一份产物写到 <工程>/build/ 根
 *
 * 文件名是 <stem>[-signed]<ext>。stem 有两套（见 build 里「产物命名」那一段）：
 * 模块级的 .bin 是 <bundleName>-<moduleName>，.bin 形态的 hap 和 .app 是 <bundleName>。
 *
 * 中间产物一个都不留，所以这里不需要「挑哪个是给人用的」—— 进来的就是答案。
 * 顺手删掉其它形态（3 种后缀 × 签/未签两种）：那是上一次别的 target、
 * 或者 cert/ 里材料变了留下的旧包，留着会让人装错。
 * 清理要把两套 stem 一起扫 —— 只按当前 stem 删的话，上一次 .app 用的是另一套名字，
 * 那份旧包就永远没人删，而它的名字跟新产物只差一个模块名，装的时候最容易混淆。
 */
function publish(buf, outRoot, stem, ext, signed, staleStems) {
  const name = `${stem}${signed ? "-signed" : ""}${ext}`;
  const dest = path.join(outRoot, name);
  fs.mkdirSync(outRoot, { recursive: true });
  for (const s of staleStems) {
    for (const otherExt of [".app", ".hap", ".bin"]) {
      for (const otherSign of ["", "-signed"]) {
        const other = `${s}${otherSign}${otherExt}`;
        if (other !== name) fs.rmSync(path.join(outRoot, other), { force: true });
      }
    }
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
 *
 * 输出形态统一是「▸ 先写标题 → 中间写明细 → ✓ 尾写总时间」，每一层都一样：
 *
 *   ▸ compile js
 *     ▸ webpack
 *       · bootstrap            1293 ms
 *       ▸ make
 *         · .js x31            1382 ms
 *       ✓ make                 2346 ms
 *     ✓ webpack                5178 ms
 *   ✓ compile js               5432 ms
 *
 * 标题要等第一个明细到来时才打：没有明细的步骤（read project、write bin…）
 * 仍然只有一行，不然每一步都变成「标题 + 时间」两行，通篇都是重复。
 *
 * 三个打印原语都挂在 step.child 上（调用方 compileJs 拿到的就是 child）：
 *   child(name, fn)       包住一个同步/异步动作计时，打 level 1 的一行
 *   child.title(d, name)  打标题 ▸，明细跟在它后面
 *   child.detail(d, name, ms)  打一条**已经测好**的明细
 *   child.total(d, name, ms)   打标题的收尾 ✓ 行
 * title/detail/total 用来打印 webpack 内部那种「时间戳由子进程带回来」的数字，
 * 只能在事后补打，没法包住 fn 去计时。
 */
function makeStepTimer(log) {
  // 当前正在跑的步骤。整条链是串行的，同一时刻只有一步
  let current = null;

  /**
   * 一行耗时。depth 0 是主步骤（✓ read project），1 是 child（· manifest），
   * 2 起是 webpack 内部的明细。
   * 数字列默认固定在 25 列：2×depth + 2 个字符的符号位，名字补齐到 24 列，再空一格。
   * width 是名字列宽的可选覆盖 —— webpack 逐文件明细的名字长短差很多，
   * 固定 22 列会让最长的那些把数字挤到右边，由调用方给出统一的列宽。
   */
  const line = (depth, mark, name, ms, width) => {
    const head = `${"  ".repeat(depth)}${mark} `;
    const body = `${head}${name.padEnd(width ?? 24 - head.length)}`;
    return ms === undefined || ms === null ? body.trimEnd() : `${body} ${String(ms).padStart(6)} ms`;
  };

  const ensureTitle = () => {
    if (current && !current.titled) {
      current.titled = true;
      log(line(0, "▸", current.name));
    }
  };

  const step = async function step(name, fn) {
    const t0 = Date.now();
    current = { name, titled: false };
    try {
      const r = await fn();
      log(line(0, "✓", name, Date.now() - t0));
      current = null;
      return r;
    } catch (e) {
      log(`${line(0, "✗", name, Date.now() - t0)}  ${String(e.message).split("\n")[0]}`);
      current = null;
      throw new Error(`${name}: ${e.message}`, { cause: e });
    }
  };

  const child = async function child(name, fn) {
    ensureTitle();
    const t0 = Date.now();
    const r = await fn();
    log(line(1, "·", name, Date.now() - t0));
    return r;
  };

  child.title = (depth, name) => {
    ensureTitle();
    log(line(depth, "▸", name));
  };

  child.detail = (depth, name, ms, width) => {
    if (ms === undefined || ms === null) return;
    ensureTitle();
    log(line(depth, "·", name, ms, width));
  };

  child.total = (depth, name, ms) => {
    ensureTitle();
    log(line(depth, "✓", name, ms));
  };

  step.child = child;
  return step;
}
