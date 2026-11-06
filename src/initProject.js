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
  "# 这个目录由 hmlwsdk 使用：内容或是含私钥/明文密码的材料，或是每次重新生成的产物。",
  "# 整个目录不进版本库，只留这个 .gitignore 本身。",
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
  for (const f of skipped) log(`  · ${f}   已存在，跳过`);
  for (const f of updated) log(`  ~ ${f}   已补充`);

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
 * hmlwsdk 的本机配置 —— 由 hmlwsdk init 生成，**不进版本库**
 * （工程根 .gitignore 里有 /hmlwsdk.config.js）。
 *
 * sdkDir  这台机器上 hmlwsdk 的目录
 * node    跑 webpack 用哪个 node，不写就用执行构建的那个进程
 *
 * 换机器后重新跑一次 hmlwsdk init 即可，不必手改。
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
 * 编译用的 SDK 版本号。
 * 改版本改这里就行。
 *
 *   compileSdkVersion    → config.json 的 app.apiVersion.target
 *   compatibleSdkVersion → config.json 的 app.apiVersion.compatible
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
 * 项目的构建入口 —— 由 hmlwsdk init 生成，可以随便改。
 *
 *   npm run build        .app + 单 .bin 形态的 hap（cert/ 里有签名材料就自动签）
 *   npm run build:bin    只出 .bin
 *   npm run build:hap    签名 hap（要求 cert/ 里有材料）
 *   npm run build:app    签名 .app（要求 cert/ 里有材料）
 *
 *   node hmlwsdk.build.js <bin|app|signedHap|signedApp>
 *
 * hmlwsdk 不是 npm 依赖，它的位置写在 hmlwsdk.config.js 的 sdkDir 里。那个文件
 * 不进版本库，所以下面的检查是给「刚 clone 下来还没 init」的情况兜底的 ——
 * 缺什么就直说缺什么，别让 node 抛一段 import 堆栈。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(here, "hmlwsdk.config.js");

if (!fs.existsSync(configFile)) {
  console.error("找不到 hmlwsdk.config.js —— 这个工程还没初始化过（或者刚 clone 下来）。");
  console.error("在该目录运行：  hmlwsdk init");
  process.exit(1);
}

const config = (await import(pathToFileURL(configFile).href)).default ?? {};
const sdkDir = config.sdkDir && path.resolve(here, config.sdkDir);
const sdkEntry = sdkDir && path.join(sdkDir, "src", "build.js");

if (!sdkEntry || !fs.existsSync(sdkEntry)) {
  console.error(\`hmlwsdk.config.js 里的 sdkDir 是 \${sdkDir || "(空)"}，那里没有 hmlwsdk。\`);
  console.error("改 sdkDir 指向 hmlwsdk 目录，或删掉 hmlwsdk.config.js 后重新运行 hmlwsdk init。");
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
  console.error(\`\\n构建失败：\${e.message}\`);
  process.exit(1);
}
`;
}
