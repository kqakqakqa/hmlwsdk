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
 *   hmlwsdk.config.js      ✗  hmlwsdk 在哪 + 用哪个 node（本机相关，被 .gitignore 忽略）
 *   hmlwsdk-build.js       ✓  项目入口，npm run build* 这四条 script 调它
 *   cert/.gitignore        ✓  忽略目录内一切（签名材料 + 含明文密码的 signing.config.js）
 *   cert/default.p12       ✗  自带的测试私钥 —— cert/ 里一份材料都没有时才放，见下
 *   cert/signing.config.js ✗  与那份私钥成对：p12 + password
 *   build/.gitignore       ✓  忽略目录内一切（产物）
 *   package.json           ✓  补 "type": "module" 和四条 scripts（名字与 CLI 命令一致）
 *   .gitignore             ✓  追加 /hmlwsdk.config.js
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
 * 为什么必须往 package.json 写 "type": "module"：生成的三个 .js 都用 ESM 语法，
 * 而 DevEco 生成的 package.json 是 `{}` —— 没有 type 字段时 Node 把 .js 当 CommonJS，
 * `export default` 直接语法错误。已经有别的 type 值时报错退出，不静默改。
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
 * 工程里那个构建入口的文件名
 *
 * 早先叫 hmlwsdk.build.js，现在改成 hmlwsdk-build.js —— 名字里带 `.` 的那一段
 * 容易被当成扩展名的一截（读起来像 `xxx.build.js` 这种构建产物的命名习惯），
 * 改成一个普通的分隔符就没有歧义。
 * 老工程的 package.json 里还写着旧名字，由 migrateEntryScripts 改过来。
 */
const BUILDER_ENTRY = "hmlwsdk-build.js";
const LEGACY_BUILDER_ENTRY = "hmlwsdk.build.js";

/**
 * 工程 package.json 里的四条 script
 *
 * 名字与 bin/hmlwsdk.js 的 COMMANDS 完全一致 —— 用的人只记一套：
 * `npm run buildSignedApp` 和 `hmlwsdk buildSignedApp` 跑的是同一条链。
 * 早先叫 build / build:bin / build:hap / build:app，其中 build:app 指向的是
 * signedApp（强制签名）、而 build 只是「有材料就签」，光看名字分不出来。
 *
 * 值只能是 `node <BUILDER_ENTRY> <target>`：SDK 不在 PATH 里也不是 npm 依赖，
 * 能保证存在的只有工程内那个入口文件。
 */
const BUILDER_SCRIPTS = {
  buildBin: `node ${BUILDER_ENTRY} bin`,
  buildApp: `node ${BUILDER_ENTRY} app`,
  buildSignedHap: `node ${BUILDER_ENTRY} signedHap`,
  buildSignedApp: `node ${BUILDER_ENTRY} signedApp`
};

/**
 * 早先那四条 script 的名字和它们当时的默认值
 *
 * init 是幂等的、只补缺不覆盖，所以光改名的话老工程重跑会留下四条没人用的旧 script
 * （其中 build:app 还指着 signedApp，跟新的 buildSignedApp 重复）。
 * 只删「值仍是当初那个默认值」的 —— 那说明是 init 自己写的；用户改过的一律留着。
 * 值按新入口名写：老值里的旧名字已经被 migrateEntryScripts 改写过了。
 */
const LEGACY_SCRIPTS = {
  build: `node ${BUILDER_ENTRY}`,
  "build:bin": `node ${BUILDER_ENTRY} bin`,
  "build:hap": `node ${BUILDER_ENTRY} signedHap`,
  "build:app": `node ${BUILDER_ENTRY} signedApp`
};

const IGNORE_ALL_TEMPLATE = "projectInit/gitignore.txt";

/**
 * @param {object} [opts]
 * @param {string} [opts.dir]    工程目录或它下面的任意目录，省略用 cwd
 * @param {string} [opts.sdkDir]  本机 hmlwsdk 的路径，省略用本模块所在的那份
 * @param {string} [opts.node]    node 的路径，省略用 process.execPath
 * @param {(line:string)=>void} [opts.log]
 * @returns {{root:string, created:string[], skipped:string[], updated:string[]}}
 */
export function initProject(opts = {}) {
  const log = opts.log ?? console.log;
  const root = findProjectRoot(opts.dir);
  const sdkDir = path.resolve(opts.sdkDir ?? DEFAULT_SDK_DIR);
  const node = opts.node ?? process.execPath;

  const created = [];
  const skipped = [];
  const updated = [];

  // 先校验 SDK 自己是真的 —— 写进 hmlwsdk.config.js 的路径必须是能 import 的
  const sdkEntry = path.join(sdkDir, "src", "build.js");
  if (!fs.existsSync(sdkEntry)) {
    throw new Error(`${sdkDir} does not look like hmlwsdk: ${sdkEntry} is not there`);
  }

  // 版本号文件缺就补一份，别让首次 init 因为缺它直接退出
  writeIfMissing(path.join(root, BUILD_CONFIG_NAME), buildConfigTemplate(DEFAULT_SDK_VERSIONS), { root, created, skipped });
  writeIfMissing(path.join(root, "hmlwsdk.config.js"), projectConfigTemplate(sdkDir, node), { root, created, skipped });
  writeIfMissing(path.join(root, BUILDER_ENTRY), renderTemplate(`projectInit/${BUILDER_ENTRY}`), { root, created, skipped });
  writeIfMissing(path.join(root, "cert", ".gitignore"), renderTemplate(IGNORE_ALL_TEMPLATE), { root, created, skipped });
  writeSigningSeedIfEmpty(root, { created, skipped });
  writeIfMissing(path.join(root, "build", ".gitignore"), renderTemplate(IGNORE_ALL_TEMPLATE), { root, created, skipped });

  updateOwnIgnore(root, updated);
  updatePackageJson(root, { created, skipped, updated });

  log(`hmlwsdk init  ${root}`);
  for (const f of created) log(`  ✓ ${f}`);
  for (const f of skipped) log(`  · ${f}   already exists, skipped`);
  for (const f of updated) log(`  ~ ${f}   completed`);

  // 改名留下的旧入口只提示、不删：用户可能在里面加过东西，删文件不该由 init 做。
  // 但必须说出来 —— 两个看着一样用的入口文件摆在工程根，最容易改错的是旧的那个。
  if (fs.existsSync(path.join(root, LEGACY_BUILDER_ENTRY))) {
    log(`  ! ${LEGACY_BUILDER_ENTRY} is the old entry name and is no longer used; ${BUILDER_ENTRY} replaces it`);
  }

  return { root, created, skipped, updated };
}

/**
 * 往工程根的 .gitignore 追加 hmlwsdk.config.js
 *
 * 只追加这一行 —— build/ 在 DevEco 的模板里本来就忽略了，cert/ 靠自己目录里的 .gitignore。
 */
function updateOwnIgnore(root, updated) {
  const file = path.join(root, ".gitignore");
  const line = "/hmlwsdk.config.js";
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return;

  const head = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  fs.writeFileSync(file, `${head}${line}\n`);
  updated.push(".gitignore");
}

/**
 * 补 package.json 的 "type": "module" 和四条 scripts
 *
 * script 名与 CLI 的 build* 命令同名，值见 BUILDER_SCRIPTS。
 * 已有同名的 script 不覆盖 —— 用户可能已经把它接到自己的流程里了；
 * 旧名字只在值仍是当初默认值时清掉，见 LEGACY_SCRIPTS。
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

  // 入口文件改名这件事要先做一遍：老工程的 script 还指着旧文件名，
  // 而新 init 不再生成那个文件，不迁移就是 `npm run buildBin` 直接报找不到。
  migrateEntryScripts(pkg.scripts);

  // 先清老名字再补新名字：反过来的话 build:app 还占着位置，新的 buildSignedApp
  // 会一并加上去，两条 script 指着同一个 target。
  for (const [name, cmd] of Object.entries(LEGACY_SCRIPTS)) {
    if (pkg.scripts[name] === cmd) delete pkg.scripts[name];
  }

  for (const [name, cmd] of Object.entries(BUILDER_SCRIPTS)) {
    pkg.scripts[name] ??= cmd;
  }

  if (exists && JSON.stringify(pkg) === before) return;

  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  (exists ? updated : created).push("package.json");
}

/**
 * 把 package.json 里指向旧入口名的 script 改写成新名字
 *
 * 只认「命令以 `node hmlwsdk.build.js` 开头」这一种形态 —— 那就是 init 自己当初写的值。
 * 后面跟着什么参数都照改：那些命令指向的正是被改名的那个文件，不改就是断的。
 * 换成 npx / 指向自己的包装脚本 / 干脆不是字符串的，一律不动。
 */
function migrateEntryScripts(scripts) {
  for (const [name, cmd] of Object.entries(scripts)) {
    if (typeof cmd !== "string" || !cmd.startsWith(`node ${LEGACY_BUILDER_ENTRY}`)) continue;
    scripts[name] = cmd.replace(LEGACY_BUILDER_ENTRY, BUILDER_ENTRY);
  }
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

/** 路径写进 .js 文件里，统一正斜杠 —— 反斜杠在字符串里要转义，读起来也乱 */
const toPosix = (p) => p.replace(/\\/g, "/");

function projectConfigTemplate(sdkDir, node) {
  return renderTemplate("projectInit/hmlwsdk.config.js", {
    sdkDir: toPosix(sdkDir),
    node: toPosix(node)
  });
}

/**
 * build.config.js 的内容 —— 缺文件时由 init 用 DEFAULT_SDK_VERSIONS 渲染
 */
export function buildConfigTemplate({ compileSdkVersion, compatibleSdkVersion }) {
  return renderTemplate("projectInit/build.config.js", { compileSdkVersion, compatibleSdkVersion });
}
