import fs from "fs";
import path from "path";

/**
 * 读一个 liteWearable 工程，返回构建需要的一切输入
 *
 * 工程目录指的是「模块目录的上一级」，例如 apps/devdemo/devdemo（里面有 entry/）。
 * 只处理 entry 一个模块 —— 多模块/HAR 还没做，见 AGENTS.md 待办。
 *
 * @param {string} projectDir
 * @returns {{root:string, moduleDir:string, srcConfig:object, compileSdkVersion:number, compatibleSdkVersion:number}}
 */
export function readProject(projectDir) {
  const root = path.resolve(projectDir);
  const moduleDir = path.join(root, "entry");
  const configPath = path.join(moduleDir, "src", "main", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `cannot find ${configPath}, make sure the project dir points at the level that contains entry/`
    );
  }

  return {
    root,
    moduleDir,
    srcConfig: JSON.parse(fs.readFileSync(configPath, "utf8")),
    ...readSdkVersions(moduleDir)
  };
}

/**
 * 从模块的 build.gradle 读两个 SDK 版本号
 *
 * 这两个值决定 config.json 里的 app.apiVersion：
 *   compileSdkVersion    → app.apiVersion.target
 *   compatibleSdkVersion → app.apiVersion.compatible
 *
 * 早先 hmlwsdk.js 里把 6 / 3 写死了（注释写着「本 SDK 还不会解析 Groovy DSL」），
 * 换个工程只要版本不同，apiVersion 就写错，产物在设备上的兼容性判断会跟着错。
 *
 * 只认 Groovy 的 `key value` 和 `key = value` 两种写法。读不到就报错，不猜默认值 ——
 * 静默用错版本比直接失败更难查。
 */
function readSdkVersions(moduleDir) {
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
