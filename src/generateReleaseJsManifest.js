import fs from "fs";
import path from "path";

import { todo } from "./createTaskContext.js";

/**
 * generateReleaseJsManifest —— 给 webpack 准备组件清单
 *
 * 产出 js/release/jsManifest/<组件名>/manifest.json，这个文件是
 * compileReleaseJsWithNode 的输入（aceManifestPath）。
 *
 * 实测内容（apps/_empty/_empty，4 空格缩进、末尾无换行）：
 *
 *   {
 *       "appID": "com.github.kqakqakqa.hmlitewearable._empty",
 *       "appName": "$string:appName",
 *       "versionName": "0.1.0",
 *       "versionCode": 1,
 *       "minPlatformVersion": 3,
 *       "pages": ["pages/index/index"],
 *       "deviceType": ["liteWearable"]
 *   }
 *
 * 注意 appName 保留 "$string:appName" 原样，webpack 侧才去解析资源引用，
 * 这里不做替换。
 *
 * 变体无关：debug 和 release 的 manifest.json 字段结构完全一样。
 */

export const name = "generateReleaseJsManifest";
export const produces = "js/release/jsManifest/<component>/manifest.json";

export function run(taskContext) {
  const c = taskContext.config;
  if (!c) todo(name, "missing taskContext.config, run mergeReleaseProfile first");

  const jsModules = c.module?.js;
  if (!jsModules?.length) todo(name, "config.json has no module.js, cannot get the component names and pages");

  const comp = jsModules[0];
  const outDir = path.join(taskContext.work, "js", "release", "jsManifest", comp.name);
  const out = path.join(outDir, "manifest.json");

  const manifest = {
    appID: c.app.bundleName,
    appName: comp.name === "default" ? "$string:appName" : `$string:${comp.name}_appName`,
    versionName: c.app.version.name,
    versionCode: c.app.version.code,
    minPlatformVersion: c.app.apiVersion.compatible,
    pages: comp.pages,
    deviceType: c.module.deviceType
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 4));

  taskContext.paths.jsManifest = out;
  return out;
}
