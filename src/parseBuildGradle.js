import fs from "fs";
import path from "path";

/**
 * 从模块的 build.gradle 读两个 SDK 版本号
 *
 * 这两个值决定 config.json 里的 app.apiVersion：
 *   compileSdkVersion    → app.apiVersion.target
 *   compatibleSdkVersion → app.apiVersion.compatible
 *
 * 早先 `bin/hmlwsdk.js` 里把 6 / 3 写死了（注释写着「本 SDK 还不会解析 Groovy DSL」），
 * 换个工程只要版本不同，apiVersion 就写错，产物在设备上的兼容性判断会跟着错。
 *
 * 只认 Groovy 的 `key value` 和 `key = value` 两种写法。读不到就报错，不猜默认值 ——
 * 静默用错版本比直接失败更难查。
 */
export function parseBuildGradle(moduleDir) {
  const file = path.join(moduleDir, "build.gradle");
  if (!fs.existsSync(file)) {
    throw new Error(`cannot find ${file}, unable to determine compileSdkVersion / compatibleSdkVersion`);
  }

  const src = fs.readFileSync(file, "utf8");

  const read = (key) => {
    const m = src.match(new RegExp(`\\b${key}\\s*=?\\s*(\\d+)`));
    if (!m) throw new Error(`${key} not found in ${file}`);
    return Number(m[1]);
  };

  return {
    compileSdkVersion: read("compileSdkVersion"),
    compatibleSdkVersion: read("compatibleSdkVersion")
  };
}
