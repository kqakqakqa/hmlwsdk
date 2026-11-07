import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { findProjectRoot } from "./readProjectConfig.js";
import { BUILD_CONFIG_NAME } from "./readProject.js";
import { renderTemplate } from "./renderTemplate.js";

/**
 * hmlwsdk init —— 把一个已有的 liteWearable 工程变成「一条命令出包」的工程
 *
 * 只加文件，不动原有结构：entry/ 原样保留。
 *
 * **前提是工程根已经有 build.config.js**（两个 SDK 版本号）。create 造出来的工程自带，
 * 老工程得自己写一份 —— 早先 init 会去解析 entry/build.gradle 把它推导出来，
 * 那条路已经删了。
 *
 * 生成的东西（勾 = 进版本库）：
 *
 *   hmlwsdk.config.js     ✗  hmlwsdk 在哪 + 用哪个 node（本机相关，被 .gitignore 忽略）
 *   hmlwsdk.build.js      ✓  项目入口，npm run build 调它
 *   cert/.gitignore       ✓  忽略目录内一切（签名材料 + 含明文密码的 signing.config.js）
 *   build/.gitignore      ✓  忽略目录内一切（产物）
 *   package.json          ✓  补 "type": "module" 和 scripts
 *   .gitignore            ✓  追加 /hmlwsdk.config.js
 *
 * 上面这四个文件的内容不写在这里 —— 它们是给用户读、让用户改的源码，
 * 原样放在 templates/projectInit/ 下，由 renderTemplate 填占位符。
 * build.config.js 与 signing.config.js 也走同一套模板，用的人分别是
 * createProject（这里导出 buildConfigTemplate）和 readSigningConfig。
 *
 * 幂等：已存在的文件不覆盖，只补缺的。可以随时重跑。
 *
 * 为什么必须往 package.json 写 "type": "module"：生成的三个 .js 都用 ESM 语法，
 * 而 DevEco 生成的 package.json 是 `{}` —— 没有 type 字段时 Node 把 .js 当 CommonJS，
 * `export default` 直接语法错误。已经有别的 type 值时报错退出，不静默改。
 */

export const DEFAULT_SDK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUILDER_SCRIPTS = {
  build: "node hmlwsdk.build.js",
  "build:bin": "node hmlwsdk.build.js bin",
  "build:hap": "node hmlwsdk.build.js signedHap",
  "build:app": "node hmlwsdk.build.js signedApp"
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

  // 前提先验，别先落一地文件才发现缺版本号
  requireBuildConfig(root);

  writeIfMissing(path.join(root, "hmlwsdk.config.js"), projectConfigTemplate(sdkDir, node), { root, created, skipped });
  writeIfMissing(path.join(root, "hmlwsdk.build.js"), renderTemplate("projectInit/hmlwsdk.build.js"), { root, created, skipped });
  writeIfMissing(path.join(root, "cert", ".gitignore"), renderTemplate(IGNORE_ALL_TEMPLATE), { root, created, skipped });
  writeIfMissing(path.join(root, "build", ".gitignore"), renderTemplate(IGNORE_ALL_TEMPLATE), { root, created, skipped });

  updateOwnIgnore(root, updated);
  updatePackageJson(root, { created, skipped, updated });

  log(`hmlwsdk init  ${root}`);
  for (const f of created) log(`  ✓ ${f}`);
  for (const f of skipped) log(`  · ${f}   already exists, skipped`);
  for (const f of updated) log(`  ~ ${f}   completed`);

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
 * 补 package.json 的 "type": "module" 和 scripts
 *
 * 已有同名的 script 不覆盖 —— 用户可能已经把它接到自己的流程里了。
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
  for (const [name, cmd] of Object.entries(BUILDER_SCRIPTS)) {
    pkg.scripts[name] ??= cmd;
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
 * 工程根必须有 build.config.js，没有就说清楚该怎么补
 *
 * 不推导、不猜默认值：两个版本号决定 config.json 的 apiVersion，猜错比失败更难查。
 * 提示里给的 6 / 3 是 api6 的常见组合，只是让人有东西可抄，不是默认值。
 */
function requireBuildConfig(root) {
  const file = path.join(root, BUILD_CONFIG_NAME);
  if (fs.existsSync(file)) return;

  throw new Error(
    `${file} is missing — it holds compileSdkVersion / compatibleSdkVersion\n\n` +
      "write it yourself, for example:\n\n" +
      "  export default {\n" +
      "    compileSdkVersion: 6,\n" +
      "    compatibleSdkVersion: 3\n" +
      "  };\n\n" +
      'or run "hmlwsdk create <dir>" to start from a template that already has it'
  );
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
 * build.config.js 的内容 —— 现在只有 createProject 用它（init 不再推导版本号）
 */
export function buildConfigTemplate({ compileSdkVersion, compatibleSdkVersion }) {
  return renderTemplate("projectInit/build.config.js", { compileSdkVersion, compatibleSdkVersion });
}
