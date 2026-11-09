import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

import { readProject } from "./readProject.js";
import { mergeProfile, stringifyConfig } from "./processConfig.js";
import { compileResources } from "./compileResources.js";
import { compileJs } from "./compileJs.js";
import { assembleAssets } from "./assembleAssets.js";
import { collectFiles, entryPath } from "./collectFiles.js";
import { writeBin } from "./readWriteBin.js";
import { packBinHap, packTreeHap } from "./packHap.js";
import { packApp } from "./packApp.js";
import { signApp } from "./signApp.js";
import { prepareSigning, signBin } from "./sign/index.js";
import { readSigningConfig, CERT_DIR } from "./readSigningConfig.js";

/**
 * 整条出包链 —— 一次跑完，能出的产物全落盘
 *
 *   读工程 → 加工 config ┬─ 编译资源 ─┬─ 定型 source/ → 写 .bin（只在内存，p7b 身份）
 *                        └─ 编译 JS ──┘                            ├→ 打 hap（文件树）→ 打 .app → 落 <bundleName>.app
 *                                                                  ├→ 签 .bin → 装进 .bin 形态的 hap
 *                                                                  │            → 落 <bundleName>-signed.hap
 *                                                                  └→ 签 .app → 落 <bundleName>-signed.app
 *
 * 没有任务表、没有依赖图、没有跨步骤的 context 对象 —— 整条链 8~12 步，
 * 顺序写出来一眼能看完。早先按 target 分四条命令（buildBin / buildApp /
 * buildSignedHap / buildSignedApp），一次只出一份；现在一条 build 全出 ——
 * 末尾那几步打包加起来十几毫秒，分段跑没有收益。
 *
 * 三份产物（cert/ 里没 p7b 时只有第一份）：
 *   build/<bundleName>.app                 未签的 .app，整个应用
 *   build/<bundleName>-signed.hap          里面那个 .bin 已签，设备直接装的就是它
 *   build/<bundleName>-signed.app          签过的 .app，上架用
 * 签过的才带 -signed，所以文件名本身就说明这个包能不能直接装表。
 *
 * **未签的 .bin 不落盘。** 它唯一的去处就是签完塞进 -signed.hap —— 早先额外出过一份
 * build/<bundleName>-<moduleName>.bin，可它不是设备能装的东西（未签 = 装不上），
 * 落一份只是让人分不清该拿哪个。现在它只作为内存里的 Buffer 存在（unsignedBinBuf）。
 *
 * **写 .bin 时就写成 p7b 的身份。** 既然它只服务签名那一路，就没有「先写工程身份、
 * 再读回来改一遍」的道理：write bin 那一步直接把头与 config 的 bundleName 取 p7b 的
 * bundle-name、version.code 置 0。但**产物文件名仍用工程的 bundleName**：文件名要能
 * 一眼对回是哪个工程，包内字段要满足设备验签。
 * .app 那边一律不动 —— 里面那份 hap 的 bundleName / version 都是工程原值。因为
 * `packTreeHap` 的 config.json 由参数重写、不读磁盘那份，source/config.json 保持工程身份。
 *
 * cert/ 里凑不齐签名材料时**不报错**：只落未签的 .app，再打一行警告。
 * cert/default.p12 是 init 白送的，p7b 却只能从 AGC 申请，所以「有私钥没 p7b」
 * 是新建工程的常态 —— 这时候一个文件都不出才是坑。
 *
 * 写完就结束，**不清 `build/`** —— 同名的旧文件被覆盖，不同名的原样留着。
 * 要清理请自己清 `build/`，构建不代劳。
 * 名字带不带模块名看「这份产物代表谁」，不看后缀：hap 里那个 .bin 条目、.app 里那份
 * 文件树 hap 都是模块级产物，名字带模块名（<bundleName>-<moduleName>）；.app 装的
 * 是整个应用，只写包名。
 *
 * 必须落盘的中间文件只有 webpack 那几个 —— 它是独立进程，只能靠文件系统交接。
 * 这些都放在系统临时目录（work），跑完整个删掉：
 *   work/R.txt                     资源 id 表，只用来回填 config
 *   work/manifest/<组件>/           webpack 的输入
 *   work/source/                   .bin / hap 的原料树（config.json + assets/）
 *   work/pack/                     pack.info（同时打进 .app，文件这份是副产物）
 * work 放临时目录而不是工程里，工程 build/ 下就只有那几份产物。
 *
 * 签名材料统一从 <工程>/cert/ 读（见 readSigningConfig.js），CLI 不传 p7b/p12。
 *
 * 中间态一律用变量传，不落盘：资源直接写进 source/assets/entry（没有 res/ 中间目录），
 * .bin 和 hap 的 Buffer 留在内存里给下一步用，不会写完再读回来。
 */

/**
 * 老版本 init 生成过、现在一个都不再读取的文件
 *
 * hmlwsdk-build.js 是转发脚本（早先还叫 hmlwsdk.build.js），hmlwsdk.config.js 存
 * sdkDir + node。这两样都被「hmlwsdk 作为 devDependency + npm script 直接调命令」取代了。
 * 检测它们是为了让用老工程的人知道该重新 init，而不是对着一个改了也没反应的文件发愁。
 */
const STALE_PROJECT_FILES = ["hmlwsdk-build.js", "hmlwsdk.build.js", "hmlwsdk.config.js"];

/**
 * @param {object} opts
 * @param {string} [opts.projectDir] 工程目录（含 entry/ 的那一层），省略用 cwd
 * @param {string} [opts.work]        scratch 目录，默认系统临时目录下按工程区分的一个子目录
 * @param {string} [opts.node]        跑 webpack 的 node，默认当前进程
 * @param {object} [opts.signingConfig] 显式给签名材料，省略则读 <工程>/cert/
 * @param {(line:string)=>void} [opts.log]
 * @returns {Promise<{work:string, artifacts:string[]}>} artifacts 是这一轮落盘的全部产物路径
 */
export async function build(opts) {
  const log = opts.log ?? console.log;
  const step = makeStepTimer(log);

  // ── 读工程 + 签名材料 ────────────────────────────────────────────────
  const project = await step("read project", () => readProject(opts.projectDir));

  // 老版本 init 往工程里放过两个文件：hmlwsdk-build.js（转发脚本）和 hmlwsdk.config.js
  // （sdkDir + node）。现在一个都不再被读取，但留着会让人以为改它们有用，或者以为
  // 工程已经按新方式初始化过了 —— 尤其是 package.json 里那几条旧 script 还指着它们。
  const staleFiles = STALE_PROJECT_FILES.filter((f) => fs.existsSync(path.join(project.root, f)));
  if (staleFiles.length > 0) {
    log(
      `! this project was set up by an older hmlwsdk (${staleFiles.join(", ")} still here). ` +
        'run "hmlwsdk init" to refresh package.json, then delete those files'
    );
  }

  // 签名材料从 cert/ 读，很快（就几个文件），放在 webpack 之前 ——
  // 这样「命令要求签名但 cert/ 是空的」立刻失败，不用等 5 秒编译完才报。
  const signingConfig =
    opts.signingConfig ?? (await step("read signing", () => readSigningConfig(project.root)));

  // 解析成完整材料（p7b / 私钥 / 证书链），理由同上：密码错、证书链不全这类问题
  // 不该等编译完才暴露。写 .bin 那一步要用 p7b 的 bundle-name，所以它必须在这之前。
  // 没有签名材料时是 null —— 那种情况下 .bin 根本不落盘，也就不需要这个名字。
  const signing = signingConfig
    ? await step("read signing material", () => prepareSigning(signingConfig))
    : null;

  // 这里**不检查签名材料全不全**：缺 p7b 时只是那两份签名产物出不来，未签的
  // .app 照样能出 —— 报错退出等于把能用的东西一起拦掉。缺什么在末尾统一提示。

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
      // 用哪个 node 跑 webpack：CLI 不传，就是当前进程
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
  // 只在内存里出 Buffer，唯一的去处是签名后的 hap（未签的不落盘）。所以这里**直接写成
  // 签 hap 要的那份**：包内身份就是 p7b 的，省掉「先写工程身份、再读回来改一遍」。
  // .app 那侧不受影响 —— packTreeHap 的 config.json 用传进去的 config 参数重写，
  // 不读磁盘这份，所以 source/config.json 仍是工程原值。
  const unsignedBinBuf = await step("write bin", () => {
    const entries = collectFiles(sourceRoot);

    // 换壳：设备验签比的是 p7b 里的 bundle-name 与包内 bundleName，所以包内身份要换成
    // p7b 的值，version.code 一并置 0（依据见 hap-sign-utils/sign-app-to-hap.js 第 33-38 行）。
    // 必须在 writeBin 之前改 —— 签名摘要覆盖的是改后的字节。
    // version.name 不动；assets 里各组件 manifest.json 的 appID 也不动（参考实现同样只碰
    // config.json 和 .bin 头，设备装包读的是 config.json，这条没上真机验证过）。
    if (signing) {
      const cfgEntry = entries.find((e) => entryPath(e) === "config.json");
      if (!cfgEntry) throw new Error("source/config.json is missing, cannot write the .bin");

      const cfg = JSON.parse(cfgEntry.content.toString("utf8"));
      cfg.app.bundleName = signing.profile.bundleName;
      cfg.app.version.code = 0;
      // 重排必须走 stringifyConfig —— 打进包的 config.json 就是它写的排版
      // （4 空格缩进、非 ASCII 转义），直接用 JSON.stringify 会让格式变样。
      cfgEntry.content = Buffer.from(stringifyConfig(cfg));
    }

    return writeBin({
      bundleName: signing?.profile.bundleName ?? config.app.bundleName,
      entries
    });
  });

  // ── 产物命名 ────────────────────────────────────────────────────────
  // binStem 只用于容器内部的条目名：
  //   -signed.hap 里的 .bin 条目   <bundleName>-<moduleName>-signed.bin
  //   .app 里那份文件树 hap       <bundleName>-<moduleName>.hap
  //   pack.info 的 packages[].name <bundleName>-<moduleName>
  // 落盘的文件名只有 appStem 一套，见 publish()。
  // moduleName 取 config 里的 distro.moduleName（DevEco 生成的工程都有，值就是 entry）。
  const moduleName = config.module?.distro?.moduleName ?? "entry";
  const binStem = `${config.app.bundleName}-${moduleName}`;
  const appStem = config.app.bundleName;

  // 这一轮落盘的所有产物，顺序就是它们被写出来的顺序
  const artifacts = [];

  // ── 未签的那份 ──────────────────────────────────────────────────────
  // 只剩 .app：未签的 .bin 装不上表，落一份只会让人拿错包。
  // 文件树形态：.bin 形态进不了 .app（PackageApp 会过滤文件名含 -bin- 的）
  const treeHapBuf = await step("pack tree hap", () => packTreeHap(sourceRoot, config));

  // .app 里那个 hap 用 binStem —— pack.info 的 packages[].name 由它去后缀得来，
  // 所以这一个名字同时决定 zip 条目名和 pack.info 里的 name。
  // 它本身不带 -signed：.app 里的 hap 从不单独签，签名在 .app 自己的 zip 层。
  const appBuf = await step(
    "pack app",
    () => packApp({ outDir: packDir, hapBuf: treeHapBuf, hapName: `${binStem}.hap`, config }).appBuf
  );
  artifacts.push(publish(appBuf, outRoot, appStem, ".app", false));

  // ── 签名的两份（cert/ 里凑不齐材料就没有）───────────────────────────
  if (signing) {
    // 签的就是上面那份已经换好身份的 .bin —— 顺序不能颠倒：换在签名之后等于没换，
    // 设备仍按旧 bundleName 判。
    // 文件名仍用工程的 bundleName（binStem / appStem 都是工程值），方便对回是哪个工程。
    const signedBin = await step("sign bin", () =>
      signBin({
        unsignedBin: unsignedBinBuf,
        p7b: signing.p7b,
        keyPem: signing.keyPem,
        certPems: signing.certPems,
        signTime: signing.signTime
      })
    );
    // .bin 形态的 hap：设备直接装的就是它（里面只有那一个 .bin）。
    // 早先的实现是「打成 hap → 拆开读出 .bin → 判断已签 → 装回去」，那个拆包
    // 一步纯属白做：hap 就是把 .bin 塞进 zip，Buffer 直接拿来打就行。
    // 不往 hap 的 zip 里插 "HAP Sig Block 42" —— 设备验的是 .bin 自己的签名块，
    // 那层块没有验证价值。
    const binHap = await step("pack bin hap", () =>
      packBinHap(signedBin, `${binStem}-signed.bin`)
    );
    artifacts.push(publish(binHap, outRoot, appStem, ".hap", true));

    // .app 的签名在它自己的 zip 层（HAP Sig Block 42），所以签的是打好包的
    // appBuf，未签那份照旧留着 —— 两份内容只差签名块。
    // 里面那份 hap 一律是工程原貌（bundleName / version 都不改），换壳只针对 hap。
    const signedApp = await step("sign app", () => signApp({ appBuf, signingConfig }));
    artifacts.push(publish(signedApp, outRoot, appStem, ".app", true));
  } else {
    log(
      `! no usable signing config in ${CERT_DIR}/ — only the unsigned .app was written. ` +
        "the signed hap / app need a .p7b profile, which is issued per app by AppGallery Connect and cannot be generated locally"
    );
  }

  cleanWork(work);
  return { work, artifacts };
}

/**
 * 把一份产物写到 <工程>/build/ 根，返回它的完整路径
 *
 * 文件名是 <stem>[-signed]<ext>，stem 只有一套：工程的 bundleName。
 * 容器内部的条目名另有一套（带 -<moduleName>，见 build 里「产物命名」那一段），
 * 那个由 packBinHap / packApp 决定，与本函数无关。
 * 一轮构建调它 1~3 次，每次一份。
 *
 * **只写这一份，别的什么都不删** —— 同名的旧文件被覆盖，不同名的原样留着。
 * 早先这里会跨两套 stem 扫掉「其它形态」（3 种后缀 × 签/未签），理由是留着分不清
 * 哪个是刚出的；代价是重构建就把上一次出的包删了。现在由使用者自己清 `build/`。
 */
function publish(buf, outRoot, stem, ext, signed) {
  const name = `${stem}${signed ? "-signed" : ""}${ext}`;
  const dest = path.join(outRoot, name);
  fs.mkdirSync(outRoot, { recursive: true });
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
