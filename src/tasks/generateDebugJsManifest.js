import fs from "fs";
import path from "path";

import { todo } from "./_util.js";

/**
 * generateDebugJsManifest —— 给 webpack 准备组件清单
 *
 * 产出 js/<variant>/jsManifest/<组件名>/manifest.json（实测 274 B），
 * 这个文件是 compileDebugJsWithNode 的输入（aceManifestPath）。
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
 */

export const name = "generateDebugJsManifest";
export const produces = "js/<variant>/jsManifest/<组件>/manifest.json";

export function run(ctx) {
  const c = ctx.config;
  if (!c) todo(name, "缺少 ctx.config，必须先跑 mergeProfile");

  const jsModules = c.module?.js;
  if (!jsModules?.length) todo(name, "config.json 里没有 module.js，取不到组件名和 pages");

  const comp = jsModules[0];
  const outDir = path.join(ctx.work, "js", ctx.variant, "jsManifest", comp.name);
  const out = path.join(outDir, "manifest.json");

  const manifest = {
    appID: c.app.bundleName,
    appName: `${comp.name === "default" ? "$string:appName" : `$string:${comp.name}_appName`}`,
    versionName: c.app.version.name,
    versionCode: c.app.version.code,
    minPlatformVersion: c.app.apiVersion.compatible,
    pages: comp.pages,
    deviceType: c.module.deviceType
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 4));

  ctx.paths.jsManifest = out;
  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "js", ctx.variant, "jsManifest", "default", "manifest.json");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const mine = fs.readFileSync(ctx.paths.jsManifest);
  const want = fs.readFileSync(theirs);
  const same = mine.toString("utf8") === want.toString("utf8");
  return {
    ok: same,
    detail: same ? `${want.length} B 字节一致` : `内容不同：我 ${mine.length} B，gradle ${want.length} B`
  };
}
