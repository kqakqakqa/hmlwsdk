import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * 读一个 liteWearable 工程，返回构建需要的一切输入
 *
 * 工程目录指的是「模块目录的上一级」，例如 apps/devdemo/devdemo（里面有 entry/）。
 * 只处理 entry 一个模块 —— 多模块/HAR 还没做，见 AGENTS.md 待办。
 *
 * async 是因为版本号要从 build.config.js import 进来（见 readSdkVersions）。
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
    ...(await readSdkVersions(root))
  };
}

export const BUILD_CONFIG_NAME = "build.config.js";

/**
 * 两个 SDK 版本号，只从 build.config.js 读
 *
 * 这两个值决定 config.json 里的 app.apiVersion：
 *   compileSdkVersion    → app.apiVersion.target
 *   compatibleSdkVersion → app.apiVersion.compatible
 *
 * 缺文件或字段就报错，不猜默认值 —— 静默用错版本比直接失败更难查。
 * 早先这里还会回退去解析模块构建脚本里的 groovy 文本，那条路已经删了：
 * 工程带不带那套脚本对本 SDK 没有任何意义，build.config.js 是唯一来源。
 *
 * @param {string} root 工程根（build.config.js 在这）
 */
export async function readSdkVersions(root) {
  const configPath = path.join(root, BUILD_CONFIG_NAME);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `${configPath} is missing — it holds compileSdkVersion / compatibleSdkVersion\n` +
        'run "hmlwsdk init" in the project root, or write that file by hand'
    );
  }

  const config = (await import(pathToFileURL(configPath).href)).default ?? {};
  const pick = (key) => {
    const value = config[key];
    if (value === undefined) throw new Error(`${configPath} has no ${key}`);
    return value;
  };

  return {
    compileSdkVersion: pick("compileSdkVersion"),
    compatibleSdkVersion: pick("compatibleSdkVersion")
  };
}
