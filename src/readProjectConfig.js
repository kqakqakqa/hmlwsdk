import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * 定位工程 + 读 hmlwsdk.config.js
 *
 * hmlwsdk.config.js **不进版本库**（init 会往工程根的 .gitignore 追加一行），
 * 里面只有两项，都是本机才有意义的：
 *
 *   sdkDir   这台机器上 hmlwsdk 的绝对路径
 *   node     跑 webpack 的那个 node，不写就用当前进程的 process.execPath
 *
 * 为什么不做成 package.json 的 file: 依赖：那样绝对路径会进版本库，
 * 换台机器 clone 下来 npm install 会指向一个不存在的目录，还得再改。
 * 而 sdkDir 只在被 ignore 的文件里，重新 init 一次就修好了。
 *
 * 编译相关但不随机器变的东西不在这里 —— 版本号在 build.config.js（进版本库）。
 */

export const CONFIG_NAME = "hmlwsdk.config.js";

/**
 * 从 start 向上找 liteWearable 工程根
 *
 * 判断依据是 entry/src/main/config.json 存在（与 readProject.js 一致）。
 * 找不到就报错，不退回 cwd —— 早先 CLI 要求显式传工程目录就是怕在错目录上跑，
 * 现在改成向上找，但「找不到」仍然直接失败，不会静默拿 cwd 凑合。
 *
 * @param {string} [start] 起点，默认 cwd
 * @returns {string} 工程根（含 entry/ 的那一层）
 */
export function findProjectRoot(start = process.cwd()) {
  const from = path.resolve(start);

  for (let dir = from; ; ) {
    if (fs.existsSync(path.join(dir, "entry", "src", "main", "config.json"))) return dir;

    const up = path.dirname(dir);
    if (up === dir) {
      throw new Error(
        `cannot find a liteWearable project above ${from}: ` +
          "the project dir must contain entry/src/main/config.json"
      );
    }
    dir = up;
  }
}

/**
 * 读工程根 + hmlwsdk.config.js，并校验 sdkDir / node 真的能用
 *
 * @param {string} [projectDir] 工程目录或它下面的任意目录，省略用 cwd
 * @returns {Promise<{root:string, sdkDir:string, node:string, configPath:string}>}
 */
export async function readProjectConfig(projectDir) {
  const root = findProjectRoot(projectDir);
  const configPath = path.join(root, CONFIG_NAME);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `${CONFIG_NAME} not found in ${root}\n` +
        `run "hmlwsdk init" in that directory first — it writes ${CONFIG_NAME} with the ` +
        `path of this SDK, plus hmlwsdk.build.js and the cert/ and build/ directories`
    );
  }

  const config = (await import(pathToFileURL(configPath).href)).default ?? {};

  if (!config.sdkDir) {
    throw new Error(`${configPath} has no sdkDir, delete it and run "hmlwsdk init" again`);
  }

  const sdkDir = path.resolve(root, config.sdkDir);
  const sdkEntry = path.join(sdkDir, "src", "build.js");
  if (!fs.existsSync(sdkEntry)) {
    throw new Error(
      `${CONFIG_NAME} points at ${sdkDir}, but ${sdkEntry} is not there\n` +
        `fix sdkDir in ${configPath}, or delete that file and run "hmlwsdk init" again`
    );
  }

  const node = config.node ? path.resolve(root, config.node) : process.execPath;
  if (!fs.existsSync(node)) {
    throw new Error(`${CONFIG_NAME} points at node ${node}, which does not exist`);
  }

  return { root, sdkDir, node, configPath };
}
