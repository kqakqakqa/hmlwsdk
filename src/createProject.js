import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { DEFAULT_SDK_DIR, buildConfigTemplate, initProject } from "./initProject.js";

/**
 * hmlwsdk create —— 从内置模板造一个全新的 liteWearable 工程
 *
 *   hmlwsdk create            在当前目录建（目录里只能有 . 开头的条目）
 *   hmlwsdk create myapp      在 ./myapp 建
 *   hmlwsdk create E:/app/x   在指定路径建
 *
 * 模板是 templates/liteWearableEmpty/，只留 entry/src/main 下的运行期源码
 * （config.json、js/、resources/）加一个 .gitignore。构建脚本、wrapper、IDE 配置
 * 一个都不带 —— 本 SDK 出包不读它们，build.config.js 里的两个版本号把需要的信息
 * 接了过去。
 *
 * 模板内置在 SDK 里而不是引用 apps/_empty：那个目录是本机的样本工程，
 * 换台机器、或者哪天清理过 apps/，create 就废了。模板一共 9 个文件 20 KB。
 *
 * 复制完再走一遍 initProject —— 生成的 hmlwsdk.config.js / hmlwsdk.build.js /
 * cert/ / build/ / package.json 与 init 的产物完全一致，一份实现两处使用。
 * build.config.js 先在这里写好，因为 initProject 要求它必须存在。
 */

/** 模板在 SDK 根下，与 bin/ src/ doc/ 平级；模板是数据不是代码，不塞进 src/ */
export const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

export const TEMPLATE_NAME = "liteWearableEmpty";

/**
 * 模板固定的 SDK 版本号，与 apps/_empty 工程相同
 *
 * 这两个值决定 config.json 的 app.apiVersion：compile → target，compatible → compatible。
 * 模板不随 create 的参数变 —— 要改版本就改工程里的 build.config.js。
 */
const TEMPLATE_VERSIONS = { compileSdkVersion: 6, compatibleSdkVersion: 3 };

/**
 * @param {object} [opts]
 * @param {string} [opts.dir]    目标目录，省略用 cwd
 * @param {string} [opts.sdkDir] 本机 hmlwsdk 的路径，省略用本模块所在的那份
 * @param {string} [opts.node]   node 的路径，省略用 process.execPath
 * @param {(line:string)=>void} [opts.log]
 * @returns {{root:string, copied:string[], created:string[], skipped:string[], updated:string[]}}
 */
export function createProject(opts = {}) {
  const log = opts.log ?? console.log;
  const sdkDir = path.resolve(opts.sdkDir ?? DEFAULT_SDK_DIR);
  const root = path.resolve(opts.dir ?? process.cwd());

  const templateRoot = path.join(TEMPLATE_DIR, TEMPLATE_NAME);
  if (!fs.existsSync(path.join(templateRoot, "entry", "src", "main", "config.json"))) {
    throw new Error(`${templateRoot} is not a usable template: entry/src/main/config.json is missing`);
  }

  // 目录名就是手表上显示的应用名（string.json 的 appName），跟 _empty 的规律一致
  const appName = path.basename(root);
  if (!appName) {
    throw new Error(
      `cannot derive an app name from ${root}\n` + "pass a target directory: hmlwsdk create myapp"
    );
  }

  assertEmptyEnough(root);

  const copied = copyTemplate(templateRoot, root);
  renameAppName(root, appName);

  // 先写 build.config.js —— initProject 要求它必须存在
  writeFileOnce(path.join(root, "build.config.js"), buildConfigTemplate(TEMPLATE_VERSIONS));

  log(`hmlwsdk create  ${root}`);
  log(`  模板 ${TEMPLATE_NAME} → ${copied.length} 个文件，appName = ${appName}`);
  for (const f of copied) log(`  ✓ ${f}`);

  // 接着把它初始化成能一条命令出包的工程（init 会打自己那一份日志）
  const result = initProject({ dir: root, sdkDir, node: opts.node });

  return { root, copied, ...result };
}

/**
 * 只允许往空目录里建
 *
 * 例外是 . 开头的条目 —— 刚 git init 过的空仓库（.git/、.gitignore），
 * 或者带 .codex / .mimocode 这类工具目录的位置，都该照建不误。
 * 别的文件一律拒绝：create 是「造一个新工程」，不是「往已有工程里塞模板」。
 */
function assertEmptyEnough(root) {
  if (!fs.existsSync(root)) return;

  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`${root} already exists and is not a directory`);
  }

  const taken = fs.readdirSync(root).filter((name) => !name.startsWith("."));
  if (taken.length > 0) {
    throw new Error(
      `${root} is not empty: ${taken.slice(0, 5).join(", ")}${taken.length > 5 ? ", ..." : ""}\n` +
        "hmlwsdk create only builds into an empty directory (dot entries like .git are fine)"
    );
  }
}

/** 递归复制模板，返回复制出来的相对路径（打日志用） */
function copyTemplate(from, to) {
  const copied = [];

  const walk = (srcDir, dstDir) => {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const src = path.join(srcDir, entry.name);
      const dst = path.join(dstDir, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        walk(src, dst);
      } else {
        fs.copyFileSync(src, dst);
        copied.push(path.relative(to, dst).replace(/\\/g, "/"));
      }
    }
  };

  fs.mkdirSync(to, { recursive: true });
  walk(from, to);
  return copied;
}

/**
 * 把 resources/base/element/string.json 里的 appName 换成工程目录名
 *
 * 这是手表桌面/设置里显示的名字（config.json 的 abilities[].label 指向它）。
 * 模板里写的是占位值 "app"，这里按目录名填 —— 与 _empty 工程 value 恰好等于
 * 它自己的目录名是同一条规律。
 */
function renameAppName(root, appName) {
  const file = path.join(root, "entry", "src", "main", "resources", "base", "element", "string.json");
  if (!fs.existsSync(file)) return;

  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const item = json.string?.find((s) => s.name === "appName");
  if (!item) return;

  item.value = appName;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function writeFileOnce(file, content) {
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, content);
}
