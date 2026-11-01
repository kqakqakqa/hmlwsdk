import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** 本文件所在目录（src/），用来定位仓库内的 vendor/ */
const HERE = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * 默认优先 api6（hmscore/2.2.0）—— liteWearable 工程的 compileSdkVersion 是 6，
 * 必须用对版本的构建工具。两个版本的 ace-loader 虽然都是 1.0.11，
 * 但关键文件全都不一样（实测 SHA256）：
 *   webpack.lite.config.js          不同
 *   lib/lite/lite-image2bin.js      不同（api7 会写 xxx.bin + xxx.png.bin 两份，api6 只写一份）
 *   lib/lite/lite-image-coverter-plugin.js  不同
 *   main.product.js                 不同
 * 用错版本会凭空多出 .png.bin 条目、图片转换结果也不一样。
 */
const DEFAULT_CANDIDATES = [
  "C:/Users/kqa/AppData/Local/Huawei/Sdk/hmscore/2.2.0",
  "C:/Users/kqa/AppData/Local/Huawei/Sdk/hmscore/2.1.0",
  "C:/Users/kqa/AppData/Local/Huawei/Sdk/hmscore/3.0.0_7"
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

/**
 * 工具路径
 *
 * 现在只剩两个真外部依赖，都优先用仓库内的 vendor 副本（取自 Huawei SDK 2.2.0 / api6）：
 *   vendor/ace-loader/         JS 构建链（git submodule，node_modules 需自己 npm install）
 *   vendor/java-build-tools/   restool.exe
 *
 * 两个都在 vendor 里时完全不碰系统 SDK（root 为 null）；缺哪个才去 findSdkRoot 拿。
 *
 * 已经不再需要的：hmos_haptobin_tool.jar（打 .bin 用 writeBin）、hapsigntoolv2.jar
 * （签名走 src/sign 的纯 JS）、c2abc.exe / zidl.exe / lib 下三个 jar（Java 编译链），
 * 这些文件已经从仓库删掉了。
 */
export function resolveTools(sdkRoot) {
  const H = {
    ace: path.resolve(HERE, "..", "vendor", "ace-loader"),
    java: path.resolve(HERE, "..", "vendor", "java-build-tools")
  };

  const has = {
    ace: fs.existsSync(path.join(H.ace, "webpack.lite.config.js")),
    restool: fs.existsSync(path.join(H.java, "restool.exe"))
  };

  const complete = has.ace && has.restool;
  const root = sdkRoot ?? (complete ? null : findSdkRoot());

  return {
    root: root ?? "(全部来自 vendor，未使用系统 SDK)",
    restool: has.restool ? `${toSlash(H.java)}/restool.exe` : `${root}/java/build-tools/restool.exe`,
    aceLoader: has.ace ? toSlash(H.ace) : `${root}/js/build-tools/ace-loader`
  };
}

const toSlash = (p) => p.replace(/\\/g, "/");

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
