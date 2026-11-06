import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * 读一个 liteWearable 工程，返回构建需要的一切输入
 *
 * 工程目录指的是「模块目录的上一级」，例如 apps/devdemo/devdemo（里面有 entry/）。
 * 只处理 entry 一个模块 —— 多模块/HAR 还没做，见 AGENTS.md 待办。
 *
 * async 是因为版本号可能从 build.config.js 读进来（见 readSdkVersions）。
 *
 * @param {string} projectDir
 * @returns {Promise<{root:string, moduleDir:string, srcConfig:object, compileSdkVersion:number, compatibleSdkVersion:number}>}
 */
export async function readProject(projectDir) {
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
    ...(await readSdkVersions(root, moduleDir))
  };
}

export const BUILD_CONFIG_NAME = "build.config.js";

/**
 * 两个 SDK 版本号：build.config.js 优先，缺的字段回退 entry/build.gradle
 *
 * 这两个值决定 config.json 里的 app.apiVersion：
 *   compileSdkVersion    → app.apiVersion.target
 *   compatibleSdkVersion → app.apiVersion.compatible
 *
 * 为什么加 build.config.js：init 之后改版本不用再碰 gradle 文件，本 SDK 也不必
 * 依赖 Groovy 文本解析。老工程没有 build.config.js 时仍然读 entry/build.gradle，
 * 与加这个文件之前的行为完全一样。
 *
 * 两处都没有对应字段就报错，不猜默认值 —— 静默用错版本比直接失败更难查。
 *
 * @param {string} root      工程根（build.config.js 在这）
 * @param {string} moduleDir 模块目录（build.gradle 在这）
 */
export async function readSdkVersions(root, moduleDir) {
  const configPath = path.join(root, BUILD_CONFIG_NAME);
  const fromConfig = fs.existsSync(configPath)
    ? (await import(pathToFileURL(configPath).href)).default ?? {}
    : {};
  const fromGradle = readGradleVersions(path.join(moduleDir, "build.gradle"));

  const pick = (key) => {
    const value = fromConfig[key] ?? fromGradle[key];
    if (value === undefined) {
      throw new Error(
        `${key} found in neither ${configPath} nor ${path.join(moduleDir, "build.gradle")}`
      );
    }
    return value;
  };

  return {
    compileSdkVersion: pick("compileSdkVersion"),
    compatibleSdkVersion: pick("compatibleSdkVersion")
  };
}

/**
 * 从模块的 build.gradle 读两个版本号 —— init 用这个值生成 build.config.js
 *
 * 只认 Groovy 的 `key value` 和 `key = value` 两种写法。缺的字段返回 undefined，
 * 由 readSdkVersions 统一决定是回退还是报错。
 *
 * @param {string} file build.gradle 路径
 * @returns {{compileSdkVersion?:number, compatibleSdkVersion?:number}}
 */
export function readGradleVersions(file) {
  if (!fs.existsSync(file)) return {};

  const src = fs.readFileSync(file, "utf8");
  const read = (key) => {
    const m = src.match(new RegExp(`\\b${key}\\s*=?\\s*(\\d+)`));
    return m ? Number(m[1]) : undefined;
  };

  return {
    compileSdkVersion: read("compileSdkVersion"),
    compatibleSdkVersion: read("compatibleSdkVersion")
  };
}
