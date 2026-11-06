import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { findProjectRoot } from "./readProjectConfig.js";
import { BUILD_CONFIG_NAME } from "./readProject.js";

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

const IGNORE_ALL = [
  "# this directory belongs to hmlwsdk: it holds either private keys / plaintext passwords, or artifacts regenerated on every build.",
  "# the whole directory stays out of version control; only this .gitignore itself is kept.",
  "*",
  "!.gitignore",
  ""
].join("\n");

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
  writeIfMissing(path.join(root, "hmlwsdk.build.js"), builderTemplate(), { root, created, skipped });
  writeIfMissing(path.join(root, "cert", ".gitignore"), IGNORE_ALL, { root, created, skipped });
  writeIfMissing(path.join(root, "build", ".gitignore"), IGNORE_ALL, { root, created, skipped });

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
  return `/**
 * Machine-local hmlwsdk config — generated by hmlwsdk init, **kept out of version control**
 * (the project root .gitignore lists /hmlwsdk.config.js).
 *
 * sdkDir  where hmlwsdk lives on this machine
 * node    which node runs webpack; omit it to use the process running the build
 *
 * After switching machines just run hmlwsdk init again, no need to edit by hand.
 */
export default {
  sdkDir: ${JSON.stringify(toPosix(sdkDir))},
  node: ${JSON.stringify(toPosix(node))}
};
`;
}

/**
 * build.config.js 的内容 —— 现在只有 createProject 用它（init 不再推导版本号）
 */
export function buildConfigTemplate({ compileSdkVersion, compatibleSdkVersion }) {
  return `/**
 * SDK versions used for compiling.
 * To bump them, edit here.
 *
 *   compileSdkVersion    → config.json app.apiVersion.target
 *   compatibleSdkVersion → config.json app.apiVersion.compatible
 */
export default {
  compileSdkVersion: ${compileSdkVersion},
  compatibleSdkVersion: ${compatibleSdkVersion}
};
`;
}

function builderTemplate() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Build entry of this project — generated by hmlwsdk init, edit it freely.
 *
 *   npm run build        .app + the .bin-form hap (signed automatically when cert/ has material)
 *   npm run build:bin    only the .bin
 *   npm run build:hap    the signed hap (requires material in cert/)
 *   npm run build:app    the signed .app (requires material in cert/)
 *
 *   node hmlwsdk.build.js <bin|app|signedHap|signedApp>
 *
 * hmlwsdk is not an npm dependency; its location lives in sdkDir of hmlwsdk.config.js. That file
 * is kept out of version control, so the checks below cover the "just cloned, not initialised yet"
 * case — state exactly what is missing instead of letting node throw an import stack.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(here, "hmlwsdk.config.js");

if (!fs.existsSync(configFile)) {
  console.error("hmlwsdk.config.js not found — this project has never been initialised (or was just cloned).");
  console.error("run it in that directory:  hmlwsdk init");
  process.exit(1);
}

const config = (await import(pathToFileURL(configFile).href)).default ?? {};
const sdkDir = config.sdkDir && path.resolve(here, config.sdkDir);
const sdkEntry = sdkDir && path.join(sdkDir, "src", "build.js");

if (!sdkEntry || !fs.existsSync(sdkEntry)) {
  console.error(\`sdkDir in hmlwsdk.config.js is \${sdkDir || "(empty)"}, which does not contain hmlwsdk.\`);
  console.error("point sdkDir at the hmlwsdk directory, or delete hmlwsdk.config.js and run hmlwsdk init again.");
  process.exit(1);
}

const { build } = await import(pathToFileURL(sdkEntry).href);

try {
  const outputs = await build({ projectDir: here, target: process.argv[2] ?? "app", node: config.node });
  for (const [kind, p] of Object.entries(outputs)) {
    if (kind === "target" || kind === "work") continue;
    console.log(\`  \${kind.padEnd(14)} \${p}\`);
  }
} catch (e) {
  console.error(\`\\nbuild failed: \${e.message}\`);
  process.exit(1);
}
`;
}
