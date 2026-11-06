import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** 本文件所在目录（src/），ace-loader 就放在这一层 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 定位构建工具 —— 只用仓库自带的那份
 *
 *   src/ace-loader/            JS 构建链（git submodule，源码 2 MB + node_modules 133 MB）
 *                              原先这条链还要 bin/jerry-snapshot.exe 出 .bc，那个 exe 已经
 *                              删了 —— 现在 .bc 由 src/jerry-parser-wasm/ 在进程内生成
 *
 * 它原本放在 vendor/ace-loader，后来挪进 src/ 了 —— 因为它已经被改造成只服务
 * liteWearable（删掉了 card/rich/路由那一半），跟上游 ace-loader 差得不少，
 * 继续挂在 vendor/ 下容易让人以为是没动过的第三方原件。
 * **注意**：它仍然是 git submodule，跟 https://github.com/kqakqakqa/ace-loader.git
 * 对应，别当成普通源码目录去改；`git submodule update` 会把它拉到那个仓库的 `main`。
 *
 * **不读本机安装的 HarmonyOS SDK。** 早先这里有个 findSdkRoot()，会去
 * %LOCALAPPDATA%\Huawei\Sdk\hmscore\<版本> 扫系统 SDK 兜底，已删除 ——
 * 里缺了就该直接报错，而不是偷偷换成系统里另一份：
 * 版本不对会凭空多出 .png.bin 条目、图片转换结果也不一样（实测 api6 与 api7
 * 的 ace-loader 关键文件 SHA256 全不同）。
 *
 * 资源编译（原来调 vendor/java-build-tools/restool.exe）已经用 JS 重写
 * （src/compileResources.js），那份 exe 也一起删了。
 *
 * 整个构建链除 node 本身外，不依赖任何外部程序。
 */
export function resolveTools() {
  const ace = path.resolve(HERE, "ace-loader");

  // 只列真正必需的。bin/jerry-snapshot.exe 曾经在这里，但 .bc 改由
  // src/jerry-parser-wasm/ 生成之后它就不需要了，exe 也已经删掉
  // （要重新验证 wasm 产物可以从 HarmonyOS SDK 里拷回来，见 AGENTS.md）。
  const required = [path.join(ace, "webpack.lite.config.js")];

  const missing = required.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    throw new Error(
      "src/ace-loader 缺构建工具。本 SDK 只用仓库自带的副本，不读系统安装的 SDK：\n  " +
        missing.join("\n  ") +
        "\n\nace-loader 是 git submodule，克隆后要先 git submodule update --init，" +
        "再到它目录里跑 npm install。"
    );
  }

  return {
    aceLoader: toSlash(ace)
  };
}

const toSlash = (p) => p.replace(/\\/g, "/");

export function resolveNode() {
  const candidates = [
    // 正在跑这个 SDK 的 node 就是最可靠的答案，不用猜别人的安装路径
    process.execPath,
    "C:/Program Files/Huawei/DevEco Studio Next/tools/node/node.exe"
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "node"; // 交给 PATH
}
