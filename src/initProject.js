import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { findProjectRoot } from "./readProjectConfig.js";
import { BUILD_CONFIG_NAME } from "./readProject.js";
import { SIGNING_CONFIG_NAME } from "./readSigningConfig.js";
import { renderTemplate, TEMPLATE_DIR } from "./renderTemplate.js";

/**
 * hmlwsdk init —— 把一个已有的 liteWearable 工程变成「一条命令出包」的工程
 *
 * 只加文件，不动原有结构：entry/ 原样保留。
 *
 * build.config.js（两个 SDK 版本号）缺就补一份，用 DEFAULT_SDK_VERSIONS。老工程多半没有
 * 这个文件，报错让用户自己写太苛刻；但也不做「读的时候猜默认值」—— 文件必须真实落在
 * 工程里，用户想改版本号有地方可改。
 *
 * 生成的东西（勾 = 进版本库）：
 *
 *   build.config.js        ✓  compileSdkVersion / compatibleSdkVersion（缺才写，默认 6 / 3）
 *   cert/.gitignore        ✓  忽略目录内一切（签名材料 + 含明文密码的 signing.config.js）
 *   cert/default.p12       ✗  自带的测试私钥 —— cert/ 里一份材料都没有时才放，见下
 *   cert/signing.config.js ✗  与那份私钥成对：p12 + password
 *   build/.gitignore       ✓  忽略目录内一切（产物）
 *   package.json           ✓  补 "type": "module" + build script + hmlwsdk 依赖（GitHub 地址）
 *
 * **工程里不生成任何 js 入口。** 早先 init 会写 hmlwsdk-build.js（转发脚本）和
 * hmlwsdk.config.js（sdkDir + node），因为 SDK 既不在 PATH 里也不是 npm 依赖，只能靠
 * 工程内那份脚本算出「SDK 在哪」。现在 `npm run build` 直接写 `hmlwsdk build`，
 * 依赖记在 package.json 的 devDependencies 里。
 *
 * **依赖写 GitHub 地址，不写本机路径。** 这里走过一次弯路：写成
 * `"hmlwsdk": "file:<本机 SDK 路径>"` 确实能让 `npm install` 一条命令搞定，但
 * package.json 是**进版本库**的 —— 盘符、用户名、目录结构会一起提交上去
 * （跨盘符时 `path.relative` 返回绝对路径，泄露得更彻底；相对路径也只是把
 * 「绝对」降成「相对」，布局照样暴露）。改成 `github:kqakqakqa/hmlwsdk` 之后，
 * 进版本库的只剩一个公开地址。
 *
 * 已知缺口（有意不处理）：npm 装 git 依赖时不带 `--recurse-submodules`，所以装完
 * `src/ace-loader` 是空目录，构建会卡在那儿。要构建就得自己补 submodule 和它的
 * node_modules，或者改用本地 checkout + `npm link`（本地开发本来就走这条）。
 * init 不做这件事 —— 它要 clone 一个仓库、再装 133 MB 原生依赖，太重了。
 *
 * cert/ 那份私钥**只在「里面没有任何签名材料」时才放**，判定口径见
 * writeSigningSeedIfEmpty。有材料还塞一份进去会直接坏事：readSigningConfig 看到两个
 * 私钥时是报错不猜的，本来能签的工程会被 init 弄挂。所以这里是「空则补齐」，
 * 而不是无条件送。
 *
 * 上面那几个文件的内容不写在这里 —— 它们是给用户读、让用户改的源码，
 * 原样放在 templates/projectInit/ 下，由 renderTemplate 填占位符。
 * build.config.js 与 signing.config.js 也走同一套模板，用的人分别是 init 自己
 * （缺文件时用 DEFAULT_SDK_VERSIONS 渲染）和 readSigningConfig。
 *
 * 幂等：已存在的文件不覆盖，只补缺的。可以随时重跑。
 *
 * 为什么必须往 package.json 写 "type": "module"：init 写进工程的 build.config.js 和
 * cert/signing.config.js 都是 `export default`，本 SDK 用 dynamic import 读它们 ——
 * 没有这个字段 Node 把 .js 当 CommonJS，`export default` 直接语法错误。
 * 已经有别的 type 值时报错退出，不静默改。
 */

export const DEFAULT_SDK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 补 build.config.js 时用的默认版本号（api6 / 兼容 api3）
 *
 * 只在工程里没有这个文件时才用，写进去之后就是工程自己的值，随便改。
 * create 走同一个 initProject，所以新工程和 init 出来的老工程拿到的是同一份默认值。
 */
export const DEFAULT_SDK_VERSIONS = { compileSdkVersion: 6, compatibleSdkVersion: 3 };

/**
 * 工程 package.json 里那条 build script
 *
 * 名字与本 SDK 的 CLI 命令一致 —— 用的人只记一套：`npm run build` 和
 * `hmlwsdk build` 跑的是同一条链。值直接调命令，不经过工程内的任何转发脚本，
 * 所以 hmlwsdk 必须能被 npm 解析到（devDependency 装进 node_modules/.bin 就行）。
 */
const BUILD_SCRIPT = "hmlwsdk build";

/**
 * package.json 里 hmlwsdk 依赖指向哪
 *
 * 用 GitHub 地址而不是本机路径：仓库是公开的，写进版本库不泄露任何本机信息
 * （盘符 / 用户名 / 目录结构都不会出现）。这个仓库目前没有 tag，所以跟默认分支；
 * 想锁版本就手改成 `github:kqakqakqa/hmlwsdk#<tag>`，init 不会再覆盖它。
 *
 * 它装出来的东西缺 `src/ace-loader`（npm 的 git 装法不拉 submodule）——
 * 见文件头「已知缺口」。
 */
const SDK_DEP_SPEC = "github:kqakqakqa/hmlwsdk";

/**
 * 旧版本 init 写过的 script 值
 *
 * 那些值都长成 `node hmlwsdk-build.js [target]`（更早还叫 `hmlwsdk.build.js`），
 * 指向工程里那份转发脚本 —— 现在那份脚本不再生成，这些 script 留着就是断的。
 * 只清值匹配这个形状的（那说明是 init 自己写的），用户改过的一律留着。
 *
 * 覆盖过两代：`build:bin` / `build:hap` / `build:app` 那代，和
 * `buildBin` / `buildApp` / `buildSignedHap` / `buildSignedApp` 那代 —— 值和形状都一样，
 * 一个正则就够了。
 */
const LEGACY_SCRIPT_VALUE = /^node\s+hmlwsdk[-.]build\.js(\s|$)/;

/** 老版本 init 生成过、现在不再使用的文件（只提示，不删） */
const STALE_FILES = ["hmlwsdk-build.js", "hmlwsdk.build.js", "hmlwsdk.config.js"];

const IGNORE_ALL_TEMPLATE = "projectInit/gitignore.txt";

/**
 * @param {object} [opts]
 * @param {string} [opts.dir]    工程目录或它下面的任意目录，省略用 cwd
 * @param {string} [opts.sdkDir]  本机 hmlwsdk 的路径，省略用本模块所在的那份
 * @param {(line:string)=>void} [opts.log]
 * @returns {{root:string, created:string[], skipped:string[], updated:string[]}}
 */
export function initProject(opts = {}) {
  const log = opts.log ?? console.log;
  const root = findProjectRoot(opts.dir);
  const sdkDir = path.resolve(opts.sdkDir ?? DEFAULT_SDK_DIR);

  const created = [];
  const skipped = [];
  const updated = [];

  // 先校验 SDK 自己是真的 —— 提示用户去哪跑 npm link 时要指向一份能用的 SDK
  const sdkEntry = path.join(sdkDir, "src", "build.js");
  if (!fs.existsSync(sdkEntry)) {
    throw new Error(`${sdkDir} does not look like hmlwsdk: ${sdkEntry} is not there`);
  }

  // 版本号文件缺就补一份，别让首次 init 因为缺它直接退出
  writeIfMissing(path.join(root, BUILD_CONFIG_NAME), buildConfigTemplate(DEFAULT_SDK_VERSIONS), { root, created, skipped });
  writeIfMissing(path.join(root, "cert", ".gitignore"), renderTemplate(IGNORE_ALL_TEMPLATE), { root, created, skipped });
  writeSigningSeedIfEmpty(root, { created, skipped });
  writeIfMissing(path.join(root, "build", ".gitignore"), renderTemplate(IGNORE_ALL_TEMPLATE), { root, created, skipped });

  updatePackageJson(root, { created, skipped, updated });

  log(`hmlwsdk init  ${root}`);
  for (const f of created) log(`  ✓ ${f}`);
  for (const f of skipped) log(`  · ${f}   already exists, skipped`);
  for (const f of updated) log(`  ~ ${f}   completed`);

  // 老版本留下的文件只提示、不删：用户可能在里面加过东西，删文件不该由 init 做。
  // 但它们现在一个都不再被读取，留着容易让人以为改它们有用 —— 所以必须说出来。
  for (const stale of STALE_FILES) {
    if (fs.existsSync(path.join(root, stale))) {
      log(`  ! ${stale} is from an older hmlwsdk and is no longer used — it can be deleted`);
    }
  }

  // 依赖是写进 package.json 了，但要 npm install 才落到 node_modules/.bin。
  // 查一遍，免得用户第一次 npm run build 撞上 command not found。
  if (!hasHmlwsdkCommand(root)) {
    log(`  ! "hmlwsdk" is not installed yet, so "npm run build" will fail — either:`);
    log(`      npm install                        (pulls ${SDK_DEP_SPEC})`);
    log(`      cd "${sdkDir}" && npm link          (use this local checkout instead)`);
  }

  return { root, created, skipped, updated };
}

/**
 * hmlwsdk 命令找不找得到
 *
 * 两条路都算：工程内 `node_modules/.bin`（用户可能自己 `npm link hmlwsdk` 过），
 * 或者 PATH 里的任意一目录（全局 `npm link` 装法）。
 *
 * 只做「存在性」检查，不执行它 —— init 不该为了探一个命令去起进程。
 * 误判的代价是多打一行提示，不影响任何实际行为。
 */
function hasHmlwsdkCommand(root) {
  const names = process.platform === "win32" ? ["hmlwsdk.cmd", "hmlwsdk"] : ["hmlwsdk"];
  const dirs = [path.join(root, "node_modules", ".bin")];

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir) dirs.push(dir);
  }

  return dirs.some((dir) => names.some((name) => fs.existsSync(path.join(dir, name))));
}

/**
 * 补 package.json 的 "type": "module" 和 build script
 *
 * `scripts.build` 只有一条 `hmlwsdk build` —— 与本 SDK 的 CLI 命令同名，里面不含任何
 * 本机路径。已有同名的 script 不覆盖：用户可能把它接到了自己的流程里。
 * 老版本留下的那些（值长成 `node hmlwsdk-build.js [target]`）按形状清掉，
 * 它们指向的转发脚本已经不再生成。
 *
 * **依赖写 GitHub 地址，不写本机路径。** 上一版往这儿写过 `file:<本机 SDK 路径>`，
 * 而 package.json 是进版本库的 —— 盘符、用户名、目录结构会一起提交上去。
 * 现在固定写 `SDK_DEP_SPEC`；用户自己填的其它写法（版本号、带 tag 的 github 地址、
 * 他自己的 fork）一律不动，只把 `file:` 形状的旧值换掉。
 */
function updatePackageJson(root, { created, skipped, updated }) {
  const file = path.join(root, "package.json");
  const exists = fs.existsSync(file);
  const pkg = exists ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

  if (pkg.type && pkg.type !== "module") {
    throw new Error(
      `${file} has "type": "${pkg.type}", but the files hmlwsdk init writes use ESM syntax\n` +
        'change it to "type": "module", or move those files elsewhere'
    );
  }

  const before = JSON.stringify(pkg);
  pkg.type = "module";

  pkg.scripts ??= {};
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (typeof cmd === "string" && LEGACY_SCRIPT_VALUE.test(cmd)) delete pkg.scripts[name];
  }
  pkg.scripts.build ??= BUILD_SCRIPT;

  pkg.devDependencies ??= {};
  const declared = pkg.devDependencies.hmlwsdk;
  if (!declared || (typeof declared === "string" && declared.startsWith("file:"))) {
    pkg.devDependencies.hmlwsdk = SDK_DEP_SPEC;
  }

  if (exists && JSON.stringify(pkg) === before) return;

  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  (exists ? updated : created).push("package.json");
}

/**
 * 写 missing 的文件，已存在就只记一笔
 */
function writeIfMissing(file, content, { root, created, skipped }) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (fs.existsSync(file)) {
    skipped.push(rel);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  created.push(rel);
}

/**
 * cert/ 里一份签名材料都没有时，补一份自带的测试私钥
 *
 * 判定见 hasSigningMaterial：顶层出现 .p7b / .p12 / .pem 或 signing.config.js 中任何一个，
 * 就整份不动。为什么不无条件送 —— 两个原因，都是硬的：
 *
 *   1. readSigningConfig 扫到两个私钥时是报错不猜的（「found 2 signing keys」），
 *      老工程最可能的状态恰恰是「cert/ 里已经有一套能签的材料」，塞一份进去就把
 *      本来好用的工程弄挂了。
 *   2. 老工程的 p7b 一定是按它自己的证书申请的，配不上这份测试私钥，送了也用不上 ——
 *      只会让人误以为「材料齐了」。
 *
 * 一个都没有时才放：那说明这工程从来没配过签名，送一份等于「只差一个 p7b」，
 * 与 create 出来的新工程起步状态一致。两个文件必须成对落地 —— signing.config.js 里
 * 声明了 p12: "default.p12"，而 readSigningConfig 对「声明了但文件不在」是直接抛错的。
 *
 * 私钥是二进制，只能原样拷，不能走 renderTemplate：那个按 utf8 读，字节就废了。
 */
function writeSigningSeedIfEmpty(root, { created, skipped }) {
  const certDir = path.join(root, "cert");
  if (hasSigningMaterial(certDir)) return;

  const seedKey = path.join(TEMPLATE_DIR, "projectInit", "cert", "default.p12");
  writeIfMissing(path.join(certDir, "default.p12"), fs.readFileSync(seedKey), { root, created, skipped });
  writeIfMissing(path.join(certDir, SIGNING_CONFIG_NAME), renderTemplate("projectInit/cert/signing.config.js"), {
    root,
    created,
    skipped
  });
}

/**
 * cert/ 顶层有没有签名材料
 *
 * 不递归，与 readSigningConfig 的扫描口径一致 —— 用户可能在里面建了备份子目录，
 * 递归会把备份当成「已有材料」而跳过补齐，反而更难解释。
 */
function hasSigningMaterial(certDir) {
  if (!fs.existsSync(certDir)) return false;

  const materialExts = [".p7b", ".p12", ".pem"];
  return fs
    .readdirSync(certDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .some((d) => materialExts.includes(path.extname(d.name).toLowerCase()) || d.name === SIGNING_CONFIG_NAME);
}

/**
 * build.config.js 的内容 —— 缺文件时由 init 用 DEFAULT_SDK_VERSIONS 渲染
 */
export function buildConfigTemplate({ compileSdkVersion, compatibleSdkVersion }) {
  return renderTemplate("projectInit/build.config.js", { compileSdkVersion, compatibleSdkVersion });
}
