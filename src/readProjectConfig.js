import fs from "fs";
import path from "path";

/**
 * 定位工程根
 *
 * 只做一件事：从起点向上找到含 entry/src/main/config.json 的那一层。
 *
 * 早先这里还会读 hmlwsdk.config.js（sdkDir + node）—— 因为 SDK 既不在 PATH 里、
 * 也不是 npm 依赖，只能靠工程内那份文件算出「SDK 在哪」。那个文件已经取消：
 * hmlwsdk 现在是工程的 devDependency，`npm run build` 直接调 `hmlwsdk build`，
 * 跑 webpack 的 node 就是跑命令的这个 node（process.execPath）。
 *
 * 于是现在没有任何「必须存在的本机配置文件」—— clone 下来、npm install 之后
 * 就能直接构建。缺 build.config.js 这类问题由 readProject 报，那儿知道缺的是哪个字段。
 */

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
 * 读工程根
 *
 * 名字保留下来是给调用方一个稳定入口；它现在只做定位，别的校验交给各自的读取函数
 * （缺 build.config.js 由 readProject 报，缺签名材料由 readSigningConfig 报）。
 *
 * @param {string} [projectDir] 工程目录或它下面的任意目录，省略用 cwd
 * @returns {string} 工程根（含 entry/ 的那一层）
 */
export function readProjectConfig(projectDir) {
  return findProjectRoot(projectDir);
}
