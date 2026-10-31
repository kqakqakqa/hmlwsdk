import fs from "fs";
import path from "path";

/**
 * 定位本机的 HarmonyOS SDK 与各工具
 *
 * 实测本机布局：
 *   C:/Users/<user>/AppData/Local/Huawei/Sdk/
 *     hmscore/3.0.0_7/java/build-tools/restool.exe
 *     hmscore/3.0.0_7/js/build-tools/ace-loader/
 *     hmscore/3.0.0_7/js/build-tools/binary-tools/hmos_haptobin_tool.jar
 *     hmscore/3.0.0_7/toolchains/lib/hapsigntoolv2.jar
 *
 * 也可以用环境变量 HMLW_SDK_ROOT 直接指定 hmscore 版本目录。
 */

const DEFAULT_CANDIDATES = [
  "C:/Users/kqa/AppData/Local/Huawei/Sdk/hmscore/3.0.0_7",
  "C:/Users/kqa/AppData/Local/Huawei/Sdk/hmscore/2.2.0",
  "C:/Users/kqa/AppData/Local/Huawei/Sdk/hmscore/2.1.0"
];

export function findSdkRoot(explicit) {
  const tries = [];
  if (explicit) tries.push(explicit);
  if (process.env.HMLW_SDK_ROOT) tries.push(process.env.HMLW_SDK_ROOT);
  tries.push(...DEFAULT_CANDIDATES);

  for (const t of tries) {
    if (t && fs.existsSync(path.join(t, "java", "build-tools", "restool.exe"))) {
      return t.replace(/\\/g, "/");
    }
  }
  throw new Error(
    "找不到 SDK。请设置环境变量 HMLW_SDK_ROOT 指向 hmscore 版本目录，例如\n" +
      "  HMLW_SDK_ROOT=C:/Users/xxx/AppData/Local/Huawei/Sdk/hmscore/3.0.0_7"
  );
}

export function resolveTools(sdkRoot) {
  const root = sdkRoot ?? findSdkRoot();
  return {
    root,
    restool: `${root}/java/build-tools/restool.exe`,
    haptobin: `${root}/js/build-tools/binary-tools/hmos_haptobin_tool.jar`,
    aceLoader: `${root}/js/build-tools/ace-loader`,
    hapsign: `${root}/toolchains/lib/hapsigntoolv2.jar`,
    jerrySnapshot: `${root}/js/build-tools/ace-loader/bin/jerry-snapshot.exe`
  };
}

export function resolveNode() {
  const candidates = [
    process.env.HMLW_NODE,
    "D:/Programs/nodejs/node-v26.13.0-win-x64/node.exe",
    "C:/Program Files/Huawei/DevEco Studio Next/tools/node/node.exe"
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "node"; // 交给 PATH
}
