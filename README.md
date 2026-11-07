# hmlwsdk

纯 JavaScript 实现的 HarmonyOS **liteWearable（轻智能手表）**应用打包链。输入一个标准 DevEco 工程目录，输出 `.bin`、hap 和 `.app`。

```bash
hmlwsdk create myapp         # 从内置模板造一个空工程（不需要 DevEco、不需要 gradle）
cd myapp
hmlwsdk buildSignedApp       # 签名材料丢进 cert/ 之后，一条命令出包
```

已有 DevEco 工程的话跳过 `create`，先写一份 `build.config.js`（两个 SDK 版本号），再在工程根跑一次 `hmlwsdk init`（生成 `hmlwsdk.config.js` / `cert/` / `hmlwsdk.build.js`），之后一样随时 `buildSignedApp`。

运行只需要 Node.js 18 以上。不读本机安装的 HarmonyOS SDK，不需要 JDK、Gradle，也不依赖 native 二进制。

---

## 目录

- [覆盖范围](#覆盖范围)
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令参考](#命令参考)
- [工程要求](#工程要求)
- [产物](#产物)
- [构建流程](#构建流程)
- [签名](#签名)
- [已验证的部分](#已验证的部分)
- [已知差异与局限](#已知差异与局限)
- [故障排查](#故障排查)
- [作为库使用](#作为库使用)
- [目录结构](#目录结构)
- [参与开发](#参与开发)

---

## 覆盖范围

一条 liteWearable 应用的构建链从工程目录走到可安装的包，涉及五个环节：

| 环节 | Gradle 插件的做法 | 这里的实现 |
|---|---|---|
| 资源编译 | `restool.exe` 出 `resources.index` / `R.txt` / `*.bin` | `src/compileResources.js`。格式按华为开源的 `developtools_global_resource_tool` 复现，再用 api6 的 `restool.exe` 跑样本逐字节核对 |
| JS/HML/CSS 编译 | `node + webpack`（ace-loader） | 同一份 ace-loader，以 submodule 形式放在 `src/ace-loader/` |
| JS 字节码 | `jerry-snapshot.exe` 出 `*.bc` | `src/jerry-parser-wasm/`：jerryscript v2.1.0 编译成的 wasm，进程内调用，产物与 `jerry-snapshot.exe` 逐字节一致 |
| 打包 `.bin` | `hmos_haptobin_tool.jar` | `src/readWriteBin.js` |
| 签名 | `hapsigntoolv2.jar` | `src/sign/` |

表中后四个环节都是纯 JS。签名算法和 `.bin` 容器格式都来自 `hap-sign-utils`，在它的基础上改造而成；资源编译的格式细节取自上面提到的开源 C++ 源码。

产物与 Gradle 插件的产物字节级一致，逐项对照见[已验证的部分](#已验证的部分)。

### 规模与耗时

Gradle 的 `assembleRelease` 实测进 117 个 task。这里没有任务系统，`src/build.js` 一条顺序函数走完，
按命令不同是 6~10 步（`buildBin` 6 步、`buildApp` 8 步、`buildSignedApp` 10 步，`cert/` 里有签名材料时各加一步签名）。

实测 devdemo 的 release 全链，资源编译 66 ms、webpack 5.3 s，其余步骤都在毫秒级。

| 依赖 | Gradle 插件 | hmlwsdk |
|---|---|---|
| JDK | 需要 | 不需要 |
| HarmonyOS SDK | 需要 | 不需要（ace-loader 随仓库提供） |
| DevEco Studio | 需要 | 不需要 |
| Node.js | 由 DevEco 内置 | >= 18 |

---

## 环境要求

- **Node.js >= 18**（`package.json` 的 `engines` 字段）
- 磁盘空间：`src/ace-loader/node_modules` 约 133 MB（含图片转换用的 `sharp`）
- 不需要 JDK、Python、CMake、emsdk

Windows / macOS / Linux 上行为一致。`.bc` 由 `src/jerry-parser-wasm/` 在进程内生成，不起子进程。

---

## 安装

```bash
git clone --recursive https://github.com/kqakqakqa/hmlwsdk.git
cd hmlwsdk
npm install

# ace-loader 是 git submodule，要单独装依赖
cd src/ace-loader
npm install
cd ../..
```

然后把 `bin/` 加进 PATH，就能直接敲 `hmlwsdk`：

```bash
# Windows（PowerShell，写进用户环境变量，重开终端生效）
[Environment]::SetEnvironmentVariable("Path", "E:\path\to\hmlwsdk\bin;" + $env:Path, "User")

# macOS / Linux（写进 ~/.bashrc 或 ~/.zshrc）
export PATH="/path/to/hmlwsdk/bin:$PATH"
```

```bash
hmlwsdk init
hmlwsdk buildBin
```

`bin/` 下有三个文件，都是入口，只是装法不同：

| 文件 | 谁用 |
|---|---|
| `bin/hmlwsdk.js` | 真正的实现，`package.json` 的 `bin` 字段指向它（`npm link` / `npm install -g` 用） |
| `bin/hmlwsdk.cmd` | Windows 的 cmd / PowerShell。**Windows 不认 shebang**，缺了它把 `bin/` 加进 PATH 也敲不动 |
| `bin/hmlwsdk` | macOS / Linux 的 sh 包装。从 Windows 上 clone 的仓库没有执行位，要 `chmod +x bin/hmlwsdk` |

不想动 PATH 也可以走 `npm link`，它会在 npm 的全局 bin 目录里生成同类的 shim：

```bash
npm link
cd /path/to/project && hmlwsdk init
```

如果克隆时忘了 `--recursive`：

```bash
git submodule update --init
```

根目录只有一个第三方依赖：

- `jsrsasign` —— CMS SignedData 的 ASN.1 编码

PNG 压缩用 Node 内置的 `node:zlib`，不额外引包。压缩参数按 libpng 的规则配（level 9 / memLevel 8 / Z_FILTERED），产物字节随 Node 内置 zlib 的版本走，不与 Gradle 逐字节一致 —— PNG 是无损的，解压后像素相同，设备读的也是像素。详见 [`src/compressPng.js`](src/compressPng.js) 的注释。

---

## 快速开始

```bash
# ① 没有工程？造一个。目录省略时就在当前目录造（除 .git 这类点开头的条目外必须为空）
hmlwsdk create myapp
cd myapp

# ② 已经有 DevEco 工程？在工程根（含 entry/ 的那一层）跑一次 init
hmlwsdk init

# 之后在工程里任何目录下都能直接跑 —— 工程根靠 entry/src/main/config.json 向上找
hmlwsdk buildBin         # 只出 .bin
hmlwsdk buildApp         # 出 .app + 单 .bin 形态的 hap，cert/ 里有签名材料就签
hmlwsdk buildSignedHap   # 出「里面那个 .bin 已签名」的 hap（要求 cert/ 有材料）
hmlwsdk buildSignedApp   # 出签名的 .app（要求 cert/ 有材料）
```

`create` 的产物是 `apps/_empty/_empty` 那个最小 DevEco 工程**只留运行期源码**的样子：

```
myapp/
  entry/src/main/
    config.json           ← bundleName 是 com.example.app，装表前自己改掉
    js/default/           ← app.js + pages/index/{index.hml,index.css,index.js}
    resources/base/
      element/string.json ← appName 自动填成目录名（手表上显示的就是它）
      media/icon.png + icon_small.png
  build.config.js         ← compileSdkVersion 6 / compatibleSdkVersion 3
  hmlwsdk.config.js       ← 本机 SDK 路径（不进版本库）
  hmlwsdk.build.js + package.json + .gitignore
  cert/default.p12        ← 模板自带的私钥库（密码见同目录 signing.config.js）
  cert/signing.config.js  ← 已经写好了 p12 + password，只差一个 p7b
  cert/  build/           ← 各带一个忽略一切的 .gitignore
```

没有 `build.gradle`、`settings.gradle`、`gradlew`、`local.properties`、`.idea/` ——
本 SDK 出包一个都不读，版本号在 `build.config.js` 里。唯一的硬约束是 `bundleName`：
模板固定写 `com.example.app`，多个工程同时装表会互相顶掉，装之前改成自己的。
`create` 完之后可以直接 `hmlwsdk buildBin`（实测 3.3 s 出 `.bin`）。

**模板自带私钥，不带 profile。** `cert/` 里那份 `default.p12` 是模板的一部分，`create` 出来就有，
所以私钥这一半不需要用户自己搞；缺的是 p7b —— 那是华为按 bundleName 签发的 profile，
没法本地生成，得去 AppGallery Connect 申请（或者从任意已签名的 hap 里用
`hap-sign-utils/extract-hap-to-app-p7b.js` 抽一份）。把 p7b 丢进 `cert/` 就能直接
`hmlwsdk buildSignedApp`，不用改配置：`signing.config.js` 里的 `p12` / `password` 已经填好，
`p7b` 会自动补上。

`init` 那一步在工程里多出这些东西，**都不用传参数**：

```
hmlwsdk.config.js     ← 不进版本库：本机 hmlwsdk 的路径 + 用哪个 node
hmlwsdk.build.js      ← 进版本库：npm run build* 的入口
cert/                 ← 进版本库的只有 .gitignore，签名材料丢在这里
  .gitignore
  signing.p7b         ← 你放进去的 profile
  signing.p12         ← 你放进去的私钥库（或 signing.pem）
  signing.config.js   ← 自动生成：p7b / p12 / password
build/                ← 产物，只有 .gitignore 进版本库
  <bundleName>-<moduleName>[-signed].bin|hap|app  ← 一次构建只落一份
```

`init` **不往老工程里塞私钥** —— 那三行得你自己放。自带 `default.p12` 的只有 `create`
从模板造出来的工程，见上面那段。

`build.config.js` 不在这里 —— 它是**前提**，不是 init 生成的。`create` 造出来的工程自带，
老工程得自己写一份（`export default { compileSdkVersion: 6, compatibleSdkVersion: 3 }`）。
缺了 init 直接报错并给出可抄的内容，不会猜默认值。

`init` 只加文件，不动 `entry/` —— DevEco 那边照旧能用。
重复跑是幂等的：已有文件只跳过不覆盖。

`build/.gitignore` 与 `cert/.gitignore` 内容一样（`*` + `!.gitignore`）。注意 DevEco 生成的
工程根 `.gitignore` 里是 `/build`（整目录忽略），父目录被忽略后 git 不会进这个目录，所以
`build/.gitignore` 本身也不会进版本库 —— 这不影响什么，构建时会自己建目录；对没有这条规则的
工程它就正常起作用。

`package.json` 会被补上 `"type": "module"`（生成的 `.js` 用 ESM 语法，DevEco 默认的
`package.json` 是 `{}`，没有这个字段 Node 会把它们当 CommonJS 而报语法错）和四个 scripts。
script 名就是 CLI 那四条 build 命令，`npm run buildSignedApp` 与 `hmlwsdk buildSignedApp`
跑的是同一条链：

```bash
npm run buildBin        # .bin
npm run buildApp        # .app，cert/ 有材料就签
npm run buildSignedHap  # 里面那个 .bin 已签名的 hap，要求 cert/ 有材料
npm run buildSignedApp  # 签名后的 .app，要求 cert/ 有材料
```

---

## 命令参考

### 基本形式

```
hmlwsdk <命令> [工程目录]
```

`init` / `build*` 的工程目录可以省略 —— 省略时从当前目录向上找含 `entry/src/main/config.json` 的那一层。
`create` 的目录参数是**字面目标路径**（在那里新建，所以不能要求它已经存在），省略时用当前目录。
**没有任何签名相关参数**：签名材料统一从 `<工程>/cert/` 读。

`create` / `init` 各一条，加上四条 build 命令 = 两个停止点（`.bin` / hap 或 `.app`）× 有没有签名材料。

| 命令 | 做什么 | 产出 |
|---|---|---|
| `create` | 从内置模板造一个新工程（模板 = 最小工程源码，不含任何构建脚本） | `entry/src/main/**`、`build.config.js`、`hmlwsdk.config.js`、`hmlwsdk.build.js`、`package.json`、`.gitignore`、`cert/`、`build/` |
| `init` | 把已有工程初始化成「一条命令出包」 | 见[快速开始](#快速开始) |
| `buildBin` | 只出 `.bin` | `build/<bundleName>-<moduleName>.bin`（签过带 `-signed`） |
| `buildApp` | 出 `.app`，`cert/` 有材料就顺带签 | `build/<bundleName>-<moduleName>.app`（签过带 `-signed`） |
| `buildSignedHap` | 出「里面那个 `.bin` 已签名」的 hap | `build/<bundleName>-<moduleName>-signed.hap` |
| `buildSignedApp` | 出签名后的 `.app` | `build/<bundleName>-<moduleName>-signed.app` |

`buildSignedHap` / `buildSignedApp` **要求 `cert/` 里真有签名材料**，没有直接报错 ——
命令名承诺了要出签名产物，静默退回 unsigned 是坑。
`buildBin` / `buildApp` 有材料就顺带签，与 Gradle 没配 `signingConfig` 就出 unsigned 的行为一致。

不管哪条命令，**只落一份产物**：`<工程>/build/<bundleName>-<moduleName>[-signed].<ext>`，
`<ext>` 由命令决定（`.bin` / `.hap` / `.app`），签过的才带 `-signed`。
写之前会先删掉同 stem 的其它形态（3 种后缀 × 签/未签两种）—— 留着就是上一次的旧包，装的时候分不清。
中间产物全在系统临时目录里，跑完整个删掉，`build/` 下只剩那一份能直接用的。

**没有单独的签名命令，也没有 `buildHap`。** 未签名的 `.bin` 和 hap 都是中间产物，只在内存里往后传。

### 构建步骤

没有任务系统、没有依赖图 —— `src/build.js` 就是一条顺序函数，命令只是它的 `target` 别名：

```
buildBin       → bin
buildApp       → app
buildSignedHap → signedHap
buildSignedApp → signedApp
```

下表里的 `<stem>` = `<bundleName>-<moduleName>`，`moduleName` 取 config 里的 `distro.moduleName`（值就是 `entry`）。

| 步骤 | 做什么 | 产物 |
|---|---|---|
| `read project` | 读 build.config.js 的版本号 + 源码 config.json | 无 |
| `read signing` | 读 `cert/`，自动发现 p7b / 私钥 / 密码 | 无（回写 `cert/signing.config.js`） |
| `merge config` | 注入 apiVersion、abilities 默认值 | 无（传对象，不落盘） |
| `compile resources` | 编译资源（JS 实现，原 restool 的活） | `work/source/assets/entry/resources.index` + `resources/`<br>`work/R.txt` |
| `compile js` | node + webpack 编译，再出 `.bc` | `work/source/assets/js/<组件>/*.js` `*.bc`<br>`work/manifest/<组件>/manifest.json` |
| `assemble assets` | 回填资源 id、定型 config、删多余文件 | `work/source/config.json` |
| `write bin` | 打成 `.bin` 私有容器 | 内存 Buffer，hap 里的条目名是 `<stem>.bin` |
| `sign bin` | 签 `.bin`（`cert/` 有材料才跑） | 内存 Buffer，`<stem>-signed.bin` |
| `pack bin hap` | `.bin` 装进 hap —— **设备直接装的就是这种** | 内存 Buffer |
| `pack tree hap` | 文件树形态的 hap，只进 `.app` | 内存 Buffer |
| `pack app` | 打 `.app` | 内存 Buffer（内含 `<stem>.hap` + `pack.info`），同时落一份 `work/pack/pack.info` |
| `sign app` | 签 `.app`（`cert/` 有材料才跑） | 内存 Buffer |
| `publish` | 写到 `build/` 根，删掉同 stem 的其它形态 | `build/<stem>[-signed].<ext>` ← 唯一落盘的东西 |

中间态一律用变量传，不落盘：资源直接编译进 `source/assets/entry`（没有独立的资源输出目录再拷一遍），
`.bin` 和 hap 的 Buffer 留在内存里给下一步用，不会写完再读回来。必须落盘的只有三类 ——
webpack 的输入 manifest、webpack 的输出目录、最终产物；前两个是因为 webpack 是独立进程，只能靠文件系统交接。

### 示例

```bash
# 只出 .bin，不签名
hmlwsdk buildBin apps/devdemo/devdemo

# 出签名的 app —— 签名材料在 apps/devdemo/devdemo/cert/ 里
hmlwsdk buildSignedApp apps/devdemo/devdemo

# 当前目录就是工程（或它的子目录），参数全省
hmlwsdk buildApp
```

---

## 工程要求

### 目录形状

`<工程目录>` 指向**含 `entry/` 的那一级**，不是 `entry` 本身：

```
<工程目录>/
  entry/
    build.gradle              ← 不需要，本 SDK 不读
    src/main/
      config.json             ← 必须有
      resources/              ← 资源根
        base/element/         ← string.json 之类，按 resType 分
        base/media/           ← 图片
        rawfile/              ← 原样拷进包的文件
        dark/  zh_CN/  …      ← 其它限定目录，可选
      js/
        default/              ← 组件目录，名字由 config.json 的 module.js 指定
          app.js              ← 必须有，否则 webpack 报 missing app.js
          pages/
          …
```

组件目录下**不需要**放 `manifest.json` —— 那是 `compile js` 按 `config.json` 拼出来传给 webpack 当 `aceManifestPath` 的。

CLI 启动时会从当前目录向上找 `entry/src/main/config.json`，找不到直接报错退出。

### 版本号：build.config.js

两个 SDK 版本号决定 `config.json` 里的 `app.apiVersion.target` / `.compatible`：

```js
// <工程目录>/build.config.js —— create 直接写好，其余工程自己写
export default {
  compileSdkVersion: 6,
  compatibleSdkVersion: 3
};
```

**这是唯一来源。** 早先缺字段时会回退去解析模块的 `entry/build.gradle`，那条路已经删了 ——
工程带不带构建脚本对本 SDK 没有意义。文件或字段缺失就报错，不猜默认值
（静默用错版本比直接失败更难查）。

### config.json

`module.js` 至少有 1 个组件；每个组件在 `src/main/js/<组件名>/` 下必须有 `app.js`，否则 webpack 报 `ERROR: missing app.js`（ace-loader 检查的就是这个文件）。

### 资源限制

`element/` 下的 JSON 支持这些 `resType`：

```
integer  string  strarray  intarray  boolean  color
theme    plural  float     pattern
```

api6 的 restool **不支持** `symbol`（报 `Json tag symbol is invalid`）和 `id`（报 `ParseJsonNodeByType unsupport ResType15`），本 SDK 照此拒收。`id` 资源要走 `base/element/id_defined.json`，不是普通 JSON。

---

## 产物

### 最终交付物

一次构建只落一份：`<工程>/build/<bundleName>-<moduleName>[-signed].<ext>`。里面是什么由命令决定：

| 命令 | 落盘路径 | 内容 |
|---|---|---|
| `buildBin` | `build/<bundleName>-<moduleName>.bin`（签过带 `-signed`） | `.bin` 私有容器，设备真正验签的对象 |
| `buildSignedHap` | `build/<bundleName>-<moduleName>-signed.hap` | 单条目 zip，只有那个 `.bin`，stored 不压缩。**设备直接装的就是这种** |
| `buildApp` | `build/<bundleName>-<moduleName>.app`（签过带 `-signed`） | 一份文件树形态 hap + `pack.info`，deflate 压缩 |
| `buildSignedApp` | `build/<bundleName>-<moduleName>-signed.app` | 同上，另外带 `.app` 自己的 zip 签名块（`HAP Sig Block 42`） |

**文件名本身就写着签没签**：`buildBin` / `buildApp` 在 `cert/` 没材料时不带 `-signed`，带了材料就加后缀。

**中间产物一个都不落盘**：未签的 `.bin`、两种 hap 全在内存里往后传。webpack 的输入和输出必须
过文件系统（它是独立进程），放在系统临时目录，构建完整个删掉 —— 所以 `build/` 下只有那一份产物。

例：`bundleName` 是 `com.example.demo`、`moduleName` 是 `entry` 时，产出
`build/com.example.demo-entry-signed.app`。

命名口径（解包时对得上）。轻量穿戴这套里只有两个名字，别混：

- **module** —— 固定 `entry`。出现在 `pack.info` 的 `distro.moduleName`、`.bin` 里的
  `assets/entry/...`、以及 `resources.index` 里每条资源路径的前缀。设备按它定位资源。
- **bundle** —— `config.json` 的 `bundleName`，就是这个应用本身。

产物名两者都带，`<bundleName>-<moduleName>` 是 stem，签过的在 stem 后面加 `-signed`：

- hap 里那个 `.bin` 叫 `<stem>.bin`，签过是 `<stem>-signed.bin`。
- `.app` 里那份 hap 叫 `<stem>.hap` —— 它本身不带 `-signed`，`.app` 里的 hap 从不单独签，
  签名在 `.app` 自己的 zip 层。
- `pack.info` 的 `packages[].name` 填的是 **hap 文件名去掉 `.hap`**（Gradle 实测填的是
  `entry-release-lite`，也是这条规则），所以这里就是 `<stem>`。注意它是 hap 自己的名字，
  既不是 module 也不是 bundle —— 只是因为我们的 hap 拿 stem 打，两者才相同。

注意两点：

- **两种 hap 形态是 release 独有的**。反编译 `SingleLiteOptionsBuilder.executePack` 确认：liteWearable 一定先跑 `binBuilder` 出 `.bin` 形态，要不要再跑 `jsBundleBuilder` 出文件树形态看 `VariantData.isNeedPackage()`，而 `selectedBuildType` 默认取 `RELEASE`。debug 只出 `.bin` 形态。
- **进 `.app` 的只有文件树形态**。`PackageApp.getHapPathFiles()` 会过滤掉「文件名含 `-bin-` 且 deviceType 含 liteWearable」的包。实测印证：`.app` 里那份 hap 的字节数与 Gradle 的 `entry-release-lite-unsigned.hap` 完全相同。

### `.bin` 内部布局

```
config.json
assets/entry/resources.index
assets/entry/resources/base/media/*.key|*.bin|*.png
assets/entry/resources/rawfile/*
assets/js/default/app.js / app.bc / manifest.json
assets/js/default/common/*.bin|*.png
assets/js/default/pages/ 下每个页面各一个 .js 和一个 .bc
```

其中 `.png` 和 `.bin` 并存的那些 `.bin` **不是资源编译的产物** —— 是 ace-loader 的 `lib/lite/lite-image2bin.js` 在 webpack 阶段顺手做的图片转换（`webpack.lite.config.js` 第 185 行）。它同时写 `xxx.bin` 和 `xxx.png.bin` 两份，`assembleAssets` 负责把双后缀那份删掉 —— Gradle 的产物里一个 `.png.bin` 都没有。

图片转 `.bin` 的格式（本 SDK 不负责转，但换 ace-loader 版本时要靠它判断）：

```
offset 0   LE uint32   固定 256
offset 4   LE uint32   width | (height << 16)
offset 8   width*height*4 字节，裸 BGRA 像素，无压缩
```

### work 目录怎么清

没有增量缓存 —— 重复跑会覆盖，要干净重来就删掉 work 目录。完整布局：

```
work/
  R.txt                       资源 id 表（只用来回填 config，不进包）
  manifest/<组件>/manifest.json   webpack 的输入
  cache/                      webpack 缓存
  source/
    config.json               最终打进包的 config
    assets/entry/             资源编译的产物（+ img2bin 补的 icon.bin）
    assets/js/<组件>/          webpack 的产物
  bin/                        *.bin
  hap/                        *.hap
  app/                        *.app + pack.info
```

⚠ `assembleAssets` **不能**整体清空 `source/`：webpack 已经把 `assets/js/**` 写在那儿了，整体清空会把 81 个文件删掉（之前 `.bin` 里只剩 `config.json` 一个条目就是这个原因）。它只清根下多余的东西和双后缀 `.png.bin`。

⚠ 反过来，`compile resources` 那一步**要**先清 `source/assets/entry` —— 工程里删掉的资源不会自己消失，留下的旧文件会被打进 `.bin`。

---

## 构建流程

### 唯一顺序来源

`src/build.js`。没有任务表、没有依赖图、没有跨步骤的 context 对象 —— 那些在 Gradle 里是为了声明式地拼装 117 个 task 才需要的，这里整条链 6~10 步，顺序写出来一眼能看完。

形状是这样（资源和 JS 两支并行，在组装处汇合）：

```
读工程 → 加工 config ┬─ 编译资源 ─┬─ 定型 source/ → 写 .bin ─┬─ 签 .bin ─┐
                     └─ 编译 JS ──┘                         │          ├→ 打 hap（.bin 形态）
                                                            └→ 打 hap（文件树）→ 打 .app → 签 .app
```

`target` 决定停在哪个产物上。表里「`cert/` 有材料才跑」的那两步，对应 Gradle 没配 `signingConfig` 就出 unsigned 的行为。

### 每步做的具体事

| 步骤 | 关键点 |
|---|---|
| `read project` | 版本号只从 `build.config.js` 读，缺文件或字段直接报错，不猜默认值 |
| `read signing` | 读 `<工程>/cert/`：先看 `signing.config.js`，缺的字段扫目录取唯一的 `.p7b` / `.p12` / `.pem` 并回写。密码没写就拿 p12 文件名试。细节见[签名](#签名) |
| `merge config` | 按 `build.config.js` 的版本号填 `app.apiVersion`、release **不写** `deviceConfig.default.debug`、`abilities` 里缺 `homeAbility` 的补 `false`。`processProfile` 那一步实测只调键顺序，已合并到这里 |
| `compile resources` | 直接编进 `source/assets/entry`。扫 `resources/` → 发 id → 写 `resources.index` / `R.txt` / 复制文件 / 压缩 PNG |
| `compile js` | `aceModuleRoot` 必须是**组件目录**（`src/main/js/<组件>`），传 `src/main` 会直接报 `missing app.js`。产物目录必须带 `assets/js/<组件名>` 这一层，否则 webpack 把 `app.js` 写在根下，与 Gradle 结构差 83 个条目。每个组件自己拼一份 manifest，不落成独立的中间产物 |
| `assemble assets` | 回填 `iconId` / `labelId`、`deviceType` 只写回 `liteWearable`、删双后缀 `.png.bin`。不搬文件 —— 资源编译和 webpack 都已经写在最终位置了 |
| `write bin` | `writeBin` 把目录序列化成 `.bin`，Buffer 留给下一步 |
| `sign bin` | 纯 JS 签名块。没配证书时跳过 |
| `pack bin hap` | 把 `.bin` 塞进 zip。直接拿 Buffer 打，不拆开再装回去 |
| `pack tree hap` | 只收文件树形态，`config.json` 和 `manifest.json` 换成紧凑单行版 |
| `pack app` | 文件树形态的 hap + `pack.info` 装进一个 zip，deflate 压缩 |
| `sign app` | 往 `.app` 的中央目录前插 `HAP Sig Block 42` |

### release 变体的差异

只做 release，debug 构建**不做** —— debug 只出 1 个 `.bin` 形态的包、webpack 不压缩，发布用不上。已落地的 release 差异：

- webpack 换 `mode production`。实测 devdemo `app.js` 6187 → 1604
- `.bc` 由 `src/generateJsSnapshot.js` → `jerry-parser-wasm` 在进程内生成。ace-loader 的 `SnapshotPlugin` 用 `--isPreview=true` 关掉，它原本靠 exec `jerry-snapshot.exe` 出 `.bc`
- sourcemap 输出到 `_releaseMap/`，打包前删掉，不交付
- webpack 的中间产物（`image_convert_result.txt`、`preview_css.json`、`_releaseMap/`）一律清掉，Gradle 的产物里没有这些
- 缓存目录必须放在产物目录**外面**。默认的 `<buildDir>/../cache` 会落在 `assets/js/cache/` 下被打进 `.bin`，实测多出 2 个 `.pack.gz`

---

## 签名

### 签名材料从哪来 —— `cert/` 目录

`buildSignedHap` / `buildSignedApp` 不带任何参数，签名材料全在工程根的 `cert/` 里：

```
cert/
  .gitignore           ← 忽略自己以外的一切
  signing.p7b          ← profile —— 唯一必须你自己提供的一份
  signing.p12          ← PKCS#12 私钥库（也可以换成签名.pem）
  signing.config.js    ← 自动生成/更新，也可以手写
```

找的规则（实现在 `src/readSigningConfig.js`）：

| 情况 | 行为 |
|---|---|
| `cert/` 不存在，或里面没有 `.p7b` | 这个工程不签名，`buildBin` / `buildApp` 出 unsigned |
| 有 `.p7b` 但没有私钥 | 报错 —— 放了 profile 就说明想签，缺私钥不能静默跳过 |
| `signing.config.js` 里写了路径 | 用它，文件必须真实存在 |
| 没写 | 扫 `cert/` 顶层，取唯一的一个 `.p7b` 和唯一的一个 `.p12` / `.pem` |
| 同名文件有多个 | 报错并列出候选，要求在 `signing.config.js` 里点名 |
| 密码没写 | 拿 **p12 的文件名**试两个候选：`signing.p12` 和 `signing` |

发现成功的结果会**回写** `cert/signing.config.js`（含明文密码，所以它放在被 ignore 的
`cert/` 里，永远不进版本库）。下次直接读它，不再扫目录。

**`create` 出来的工程不用猜密码。** 模板自带 `default.p12`，并且已经写好一份
`signing.config.js`（`p12` + `password` 两项，`p7b` 故意留空 —— 声明一个不存在的文件
是报错而不是跳过，而模板里本来就没有 profile）。所以那个「拿文件名当密码试」的兜底
只在你自己换私钥、又没写密码的时候才会走到。

两种私钥格式都支持，任何 Node 18+ 都能用：

| 格式 | 处理 |
|---|---|
| `.pem`（PKCS#8） | 明文私钥，`crypto.createPrivateKey` 直接读 |
| `.p12` / `.pfx` | 加密容器，`src/sign/parseP12.js` 解开：PBES2 用 Node 内置的 `pbkdf2` + `aes-cbc` 解外层，里层的 EncryptedPrivateKeyInfo 交给 `crypto.createPrivateKey` |

`parseP12.js` 是自己写的（约 150 行），因为现成的库都不合适：Node 直到 26.10 才有
`crypto.parsePKCS12()`；`node-forge` 只认老式 PBE-SHA1-3DES，而 DevEco / openssl 3 /
Java 11+ 导出的 p12 都是 PBES2 + PBKDF2(HMAC-SHA256) + AES-256-CBC，实测它能过 MAC 校验
却解不出内容。实测对照：自解出的私钥导出 PKCS#8 PEM 后，与
`openssl pkcs12 -nocerts -nodes` 的结果逐字节相同。

只认 PBES2。碰到老式 PKCS#12 PBE（3DES 那套）会明确报错并给出 `openssl` 转换命令。

### 实现了什么

`.bin` 和 `.app` 都在 `src/sign/` 里用纯 JS 实现，不调 `hapsigntoolv2.jar`：

| 文件 | 职责 |
|---|---|
| `signBin.js` | `.bin` 签名块（移植自 `hap-sign-utils/sign-app-to-hap.js` 的 `signBin()`，算法原样照抄） |
| `signZip.js` | 给 zip 插 `HAP Sig Block 42`，hap 和 `.app` 共用同一套块格式 |
| `buildCms.js` | CMS SignedData 的 ASN.1 编码 |
| `computeDigest.js` | 分片摘要（两套：`.bin` 用 4096 分片，zip 用 1 MB 分片） |
| `parseP7b.js` | 解析 profile，取叶子证书 |
| `parseP12.js` | 解 `.p12` 取私钥（PBES2 / PBKDF2 / AES-CBC，纯 Node 内置） |
| `loadPrivateKey.js` | PKCS#12 或裸 PEM |
| `loadCerts.js` | 内置的华为根 + 中间证书链 |
| `index.js` | `prepareSigning()` 入口 |

### hap 层签的是什么

设备验的是 `.bin` 自己的签名块，hap 只是装着 bin 的 zip。所以 `buildSignedHap` 做的事是：先签 `.bin`（`sign bin`），再把它装进 hap —— 产物 `build/<bundleName>-<moduleName>-signed.hap`，里面那个条目的名字是 `<bundleName>-<moduleName>-signed.bin`，内容与 Gradle 的 `entry-release-signed.bin` 逐字节相同。早先的实现是「打成 hap → 拆开读出 `.bin` → 判断已签 → 装回去」，那个拆包一步已经删掉了。

Gradle 的 `signReleaseHap` 在同样的事情之外，还会往 hap 这个 zip 的中央目录前再插一个 `HAP Sig Block 42`（格式已经逆出来了，就在 `signZip.js` 里，`.app` 用的同一套）。实测 `apps/_3rd/随机事件` 的一对 debug 产物：

```
entry-bin-debug-lite-unsigned.hap   6906826 B   里面是 entry-debug-signed.bin（6906662 B，已签）
entry-bin-debug-lite-signed.hap     6913411 B   同一个 .bin，字节完全相同
```

差的 6585 B 全是那个 zip 签名块。**本 SDK 不插它** —— 设备认的是 `.bin` 的签名，这层块没有验证价值，加了反而让产物和 Gradle 多一处需要对照的差异。

`.app` 里的 hap 也保持原样不重签 —— 实测用 jar 签出的 `.app` 里，`entry-release-lite.hap` 仍是未签的 144 条目文件树形态；`.app` 自己的签名是 zip 层的 `HAP Sig Block 42`，那个是要插的（`buildSignedApp` 会做），因为验证方（`hapsigntoolv2.jar verify`）读的就是它。

### 移植时的四个坑

1. **私钥是硬编码的**（`sign-app-to-hap.js` 第 8 行），华为根 + 中间证书也硬编码（第 9 行），叶子证书从 p7b 的 `bundle-info.development-certificate` 取。能不能签出设备认的包，取决于手头 p7b 的叶子证书是否与那把 key 配对 —— **不是任意 p7b 都能用**。华为 AGC 申请的 debug profile 绑定的是自己的证书，跟硬编码那把 key 不配对，用不了。
2. **`signHap()` 有副作用**：会顺手把 hap 里 `config.json` 的 `app.bundleName` 改成 p7b 里的 `bundle-name`，并把 `version.code` 置 0。那是换壳流程的痕迹，本 SDK 有自己的 bundleName，这段没照搬 —— 直接对 `.bin` 的 buffer 签，绕开 `.app` 那一层。
3. **`p7bLen` 只有 uint16**，p7b 超过 65535 B 会溢出。正常 p7b 2~4 KB，仍要加断言。
4. **分片 SHA256 的 chunkSize = 4096 是自定义算法**，不是标准 SHA256。要与设备验签一致就得原样照抄。

### p7b 从哪来

`hap-sign-utils` 的 `extract-hap-to-app-p7b.js` 能从任意已签名 hap 里把 p7b 和 unsigned hap 抽出来。

---

## 已验证的部分

每条都是拿真实产物对照出来的。**不要在没有对照的情况下改这些模块。**

| 模块 | 验证方式 | 结果 |
|---|---|---|
| `.bin` 读写 | 4 个真实 `.bin` 解析后重建，比对 SHA256 | 字节级一致 |
| `.bin` 条目排序 | `_empty` 15 个、`devdemo` 92 个条目对比 Gradle 产物 | 顺序完全一致（按路径深度 + 字节序） |
| hap 打包/解包 | 单 `.bin` 形态与文件树形态往返 | 内容一致 |
| config 加工 | 源码 → 加工 → 回填资源号，逐阶段对比 | 三阶段内容一致 |
| 资源编译 | 与 restool 1.022 的产物逐文件比对 | `R.txt` / `resources.index` 字节一致；png 像素一致（压缩字节差几 B） |
| `.bc` 生成 | devdemo 22 个 bundle 分别喂 wasm 和 SDK 的 `jerry-snapshot.exe`（debug、release 各一轮） | 22/22 逐字节一致 |
| `.bin` 签名 | 与 Gradle 产物逐段对比 | `proBlock` / `signBlock` / econtent 头完全一致 |
| hap 签名 | `buildSignedHap` 产出的 hap 里那份 `.bin` 与 `entry-release-signed.bin` 比对 | 逐字节相同（devdemo，2.3 MB / 92 条目） |
| `.app` 签名 | 产出的包交给 `hapsigntoolv2.jar` 跑 `verify` | Verify success |
| `cert/` 自动发现 | 在 `_empty` 副本上放一个 p7b + 一个 p12（密码设成 `signing`）跑 `buildSignedHap` | 密码按 p12 文件名试通并回写 `signing.config.js`；多个 p7b、有 p7b 无私钥、缺 `hmlwsdk.config.js`、`sdkDir` 指错这四条都报出可操作的错误 |
| `build.config.js` | 把 `compatibleSdkVersion` 从 3 改成 4 再构建 | `source/config.json` 的 `app.apiVersion.compatible` 跟着变 |
| 端到端 | devdemo release 的 `.bin` 对比 Gradle 的 `entry-release-unsigned.bin` | 92 个条目一条不差；其中 83 个字节相同，9 个不同（原因见[已知差异](#已知差异与局限)） |

具体样本与数字：

- **`.bin`** — `_empty`(15 条目 / 110958 B)、`atri-mdm`(903 / 10786572 B)、`腕上词典 6.4.0`(201 / 9662763 B)、`openCrab`(112 / 8893516 B)，重建 SHA256 全部相同
- **hap** — `_empty` 单 `.bin` 形态；`devdemo` 文件树形态 92 条目；`stock` 单 `.bin` 2505 KB
- **config** — `_empty` 源码 690 B → 加工后 1016 B（release，不写 `deviceConfig.default.debug`）→ 最终 1089 B（多了 `iconId` / `labelId`）。JSON 内容全对，键顺序与 Gradle 不同属正常（Gradle 用 Java HashMap，顺序无语义）
- **资源编译** — `_empty` / `devdemo` / 自造 probe（全套 element 类型）的 `resources.index` 与 `R.txt` 字节一致；png 像素一致、压缩字节差几 B
- **`.bc`** — 22 个文件 397 ms，平均 18 ms/个，比每次 exec 起进程还快

---

## 已知差异与局限

### 已知差异（不是功能问题）

1. `openCrab` / `腕上词典` 的 Gradle 产物是 **api7 的 restool 1.028** 生成的，`resources.index` 头部版本串写的是 `Restool 1.028`，本 SDK 统一写 `Restool 1.022` 对齐 api6 —— **只差第 12 个字节**。
2. `atri-mdm` 的 `rawfile/momentplay_res/moments` 下有 3 个 `.dat` 与构建产物不同。源文件是 2026-10-30 改的，Gradle 产物是 2026-08-20 的，属于产物过期，不是复制逻辑的问题（同目录另外 4 个文件字节一致）。
3. `.bin` 里 CMS 的 ECDSA 签名值不可能字节一致 —— 那取决于私钥。
4. **`resources/` 下的 png 压缩字节与 Gradle 不同**。压缩用 Node 内置 zlib，restool 用的是 zlib 1.2.11，两者压出来的字节流有差异（devdemo 的 `icon.png` 3621 → 3593 B）。PNG 无损，解压后像素相同，这是有意接受的取舍，不再追求字节一致。
5. **`assets/js/<组件>/common/` 下由 SVG 转出来的 png 与 Gradle 不同**。ace-loader 已经把 pngquant.exe 换成了 libimagequant-wasm（`src/ace-loader` 的提交 `3d7d192`），编码器从 libpng 换成 png-rs，色数 / 质量阈值的语义对齐、字节不对齐。这条差异属于 ace-loader，不在本 SDK 的控制范围内。

devdemo 端到端那 9 个不同条目就由上面三条构成：2 个资源 png（第 4 条）、6 个 `common/` 下的 png 与对应 `.bin`（第 5 条）、1 个 `config.json`（键顺序）。

### 未验证

- **图片缩放规则**。`icon.bin` 的宽高直接来自源 png，未验证遇到非目标尺寸时 Gradle 怎么处理。别假设是简单拉伸。

### 不支持

| 项 | 状态 |
|---|---|
| debug 变体 | 不做。debug 只出 `.bin` 形态且不压缩，发布用不上 |
| hap 的 zip 层签名（`HAP Sig Block 42`） | 不做。`buildSignedHap` 只保证里面那个 `.bin` 已签名，理由见[签名](#签名) |
| `symbol` 类型的资源 | 不支持，api6 的 restool 也拒收 |
| `id` 类型的资源 | 不支持，要走 `id_defined.json` |
| 多模块 / Har 依赖 | 未实现，目前只处理单个 `entry` 模块 |
| 增量构建 | 没有，重复跑直接覆盖 |
| 非 8bit / 隔行 / 调色板 PNG | 原样复制，不重编码（这几类 restool 认不认也没验证过） |

### 待查

- `needPackageBin` 开关：插件字节码里有这个名字，对应 Gradle 的哪个配置项仍未确认
- `assembleDebug` 里那些 Java 相关任务为什么一个都不跑：`transformClasses` 的 condition 在本工程不满足、没注册，整条 Java 链在装配侧是断的

---

## 故障排查

| 报错 | 原因 |
|---|---|
| `<…> is not empty: a, b, c` | `create` 只往空目录里建。换个目录，或先清空（`.git` / `.gitignore` 这类点开头的条目不算） |
| `hmlwsdk.config.js not found in <…>` | 这个工程还没 init。在工程根跑 `hmlwsdk init` |
| `hmlwsdk.config.js 里的 sdkDir 是 X，那里没有 hmlwsdk` | SDK 被挪走了（或者这个工程是从别的机器 clone 来的）。改 `sdkDir`，或删掉 `hmlwsdk.config.js` 重新 init |
| `cannot find a liteWearable project above <…>` | 当前目录及其上级都没有 `entry/src/main/config.json`。cd 进工程，或显式传工程目录 |
| `src/ace-loader 缺构建工具 …` | submodule 没拉或没装依赖。`git submodule update --init`，再 `cd src/ace-loader && npm install` |
| `<…> 下没有 app.js，确认组件名 default 对不对` | `config.json` 的 `module.js[].name` 与 `src/main/js/` 下的目录名不一致 |
| `<…>/build.config.js is missing` | 工程根没有 `build.config.js`。`create` 造出来的自带；老工程自己写一份（`export default { compileSdkVersion: 6, compatibleSdkVersion: 3 }`） |
| `found N profile files in <cert>` / `found N signing keys in <cert>` | `cert/` 里有多个候选。在 `cert/signing.config.js` 里用 `p7b` / `p12` / `keyFile` 点名要哪个 |
| `<cert> has a profile but no signing key` | 放了 `.p7b` 却没放私钥。补一个 `.p12` 或 PKCS#8 `.pem` |
| `<…>.p12 needs a password and none of the guesses worked` | 密码既没写在 `signing.config.js` 里，也不等于 p12 的文件名。手写进去 |
| `cannot decrypt the bundle — the password is most likely wrong` | p12 密码不对。手写进 `signing.config.js` |
| `unsupported PKCS#12 encryption algorithm …` | 老式 3DES 那套 PBE，本 SDK 只认 PBES2。按提示用 `openssl` 转成 `.pem` |
| `compile js: webpack failed for component default (exit N)` | webpack 报错。异常里附了最后 2000 字符的 stdout / stderr，往前翻能看到具体哪个文件 |
| `Json tag symbol is invalid` | 用了 `symbol` 资源。api6 的 restool 也不支持 |
| `ParseJsonNodeByType unsupport ResType15` | 用了 `id` 资源。要走 `base/element/id_defined.json` |
| `证书链里只找到 N 张证书，至少要根+中间两张` | `cert/signing.config.js` 的 `certPath` 指向的文件里证书不全 |
| 签出来了但装不上 | p7b 的叶子证书与私钥不配对。见[签名](#签名)第 1 条坑 |
| `unknown command: xxx` | 命令名拼错。`hmlwsdk` 不带参数跑一次会列全部命令 |

产物不对的两种情况：

- **`.bin` 里只有 `config.json` 一个条目** —— `source/` 被整体清空过（早期 bug）。删掉 work 目录重跑
- **产物里多出 `.png.bin` / `image_convert_result.txt` / `source/assets/js/cache/*.pack.gz`** —— 这些 Gradle 的产物里都没有。前者说明 `assembleAssets` 的清理没跑到，后两者说明 webpack 的缓存目录落在了产物目录里（应该由 `cacheDir` 指到 `work/cache`）

---

## 作为库使用

整条链一个函数：

```js
import { build, initProject } from "hmlwsdk";

const outputs = await build({
  projectDir: "apps/devdemo/devdemo",
  target: "signedApp",          // bin | signedHap | app | signedApp
  log: console.log              // 可选，每步一行进度；默认 console.log
});
console.log(outputs.publishedApp, outputs.publishedHap, outputs.bin);
```

签名材料默认从 `<projectDir>/cert/` 自动读（`readSigningConfig`）。要绕开这套约定、直接喂材料：

```js
await build({
  projectDir,
  target: "signedApp",
  signingConfig: { p7b: "my.p7b", keyFile: "private-pkcs8.pem" }
});
```

给不出材料又不传 `signingConfig` 时，`buildBin` / `buildApp` 出 unsigned 产物，
`signedHap` / `signedApp` 两个 target 直接报错。

初始化一个工程（等价于 `hmlwsdk init`）：

```js
initProject({ dir: "/path/to/project", sdkDir: "/path/to/hmlwsdk" });
```

从模板造一个新工程（等价于 `hmlwsdk create`，会顺带调一次 `initProject`）：

```js
import { createProject } from "hmlwsdk";

const { root, copied } = createProject({ dir: "/path/to/myapp", sdkDir: "/path/to/hmlwsdk" });
```

也可以只取单个模块用：

```js
import {
  readBin, writeBin, isSignedBin, stripSignature, SIGN_HEAD_ASCII,
  readZip, writeZip, crc32, collectFiles,
  packBinHap, packTreeHap, packApp, signApp,
  mergeProfile, stringifyConfig, stringifyConfigMinified,
  parseRTable, fillResourceIds,
  compileResources, compressPng, isSupportedPng,
  runWebpack, compileJs,
  readProject,
  prepareSigning, signBin, signZip, parseP7b, loadPrivateKey, slicedSha256,
  resolveTools, resolveNode
} from "hmlwsdk";
```

| 函数 | 用途 |
|---|---|
| `build({projectDir, target, ...})` | 整条链，返回各产物路径 |
| `readProject(projectDir)` | 读 build.config.js 版本号 + 源码 config.json |
| `readBin(buf)` / `writeBin({bundleName, entries})` | `.bin` 私有容器读写 |
| `stripSignature(buf)` / `isSignedBin(buf)` | 剥签名块 / 判断是否已签 |
| `collectFiles(dir)` | 递归扫目录成条目列表（按路径深度 + 字节序） |
| `packBinHap(binBuf, name)` / `packTreeHap(sourceRoot, config)` | 两种形态的 hap |
| `packApp({outDir, hapBuf, hapName, config})` / `signApp({appBuf, signingConfig})` | `.app` 打包与签名，都只处理 Buffer |
| `readZip` / `writeZip` / `crc32` | 手写 zip 读写（已字节级验证） |
| `mergeProfile` / `stringifyConfig` | config 加工与序列化 |
| `compileResources({moduleRoot, outDir, rTxtPath, compressImage})` | 资源编译总入口 |
| `compressPng(buf)` | PNG 重编码（原 restool 的 `-z`） |
| `compileJs({moduleDir, config, work, sourceRoot, iconDir})` | 编译 JS：每组件写 manifest → webpack → `.bc` |
| `runWebpack({moduleRoot, buildDir, manifestPath, ...})` | 只跑一次 webpack，不管 manifest 和 `.bc` |
| `prepareSigning(cfg)` / `signBin` / `signZip` | 签名 |
| `resolveTools()` / `resolveNode()` | 定位 `src/ace-loader` 和 node |

---

## 目录结构

```
bin/hmlwsdk.js          CLI 实现，package.json 的 bin 字段指向它
bin/hmlwsdk.cmd         Windows 的 cmd / PowerShell 入口（Windows 不认 shebang）
bin/hmlwsdk             macOS / Linux 的 sh 入口
templates/
  liteWearableEmpty/    新工程的模板 = 最小工程源码 + 一份自带私钥（不含构建脚本，共 11 个文件）
src/
  index.js              包的统一导出
  build.js              整条链 ← 查执行顺序看这里
  createProject.js      从模板造新工程（复制 → 改 appName → 交给 initProject）
  initProject.js        把工程初始化成「一条命令出包」（生成 config / cert / build / 入口脚本）
  readProject.js        读 build.config.js 的版本号 + 源码 config.json
  readProjectConfig.js  定位工程根 + 读 hmlwsdk.config.js（sdkDir / node）
  readSigningConfig.js  读 cert/，自动发现 p7b / 私钥 / 密码并回写 signing.config.js
  findTools.js          定位 src/ace-loader，以及用哪个 node

  ── 配置 ──
  processConfig.js      mergeProfile / stringifyConfig / stringifyConfigMinified
  parseResourceTable.js R.txt 解析、config 里资源号回填

  ── 资源 ──
  compileResources.js   资源编译总入口（扫目录 → 发 id → 写 index / R.txt / 复制文件）
  scanResourceFiles.js  扫 resources/，解析限定目录名（base / dark / zh_CN …）
  parseElementJson.js   element 下的 JSON → 记录数据段（全套类型）
  writeResourceIndex.js 写 resources.index（restool 私有格式）
  writeResourceTable.js 写 R.txt
  copyResourceFiles.js  复制 media / profile / rawfile，写 4 个空 .key
  compressPng.js        PNG 重编码，复现 restool 的 -z（用 node:zlib，像素一致）

  ── JS ──
  compileJs.js          每组件写 manifest → webpack → 清中间文件 → 出 .bc
  runWebpack.js         只跑一次 node + webpack
  generateJsSnapshot.js .js 编成 .bc（进程内跑 wasm）

  ── 组装与打包 ──
  assembleAssets.js     定型 source/：回填资源 id、写 config、删双后缀 .png.bin
  collectFiles.js       递归扫目录成条目列表（按路径深度 + 字节序）
  packHap.js            两种形态的 hap（单 .bin / 文件树）
  packApp.js            .app 打包
  signApp.js            .app 签名
  readWriteZip.js       zip 读写 + crc32
  readWriteBin.js       .bin 私有容器：读 / 写 / 签名块剥离

  sign/                 签名，8 个文件
  ace-loader/           git submodule，JS 构建链（webpack + sharp）
  jerry-parser-wasm/    js2bc：JS → JRRY v24 字节码（jerryscript v2.1.0 编的 wasm）
```

### 三条命名规矩

- **全部平铺在 `src/` 下，不建目录**。只有三个例外：`sign/`、`ace-loader/`（submodule，本来就是一整棵目录）、`jerry-parser-wasm/`（wasm 产物 + 60 行封装）。`templates/` 在 `src/` 外面（跟 `bin/` `doc/` 平级）—— 模板是数据不是代码，摆在源码目录里反而碍事。
- **文件名一律「动词 + 名词」**，不许用缩写、不许加角色后缀，也不带变体词（`debug` 不做，`release` 是唯一变体，写进名字只是噪音）。`processConfig.js` 是「加工配置」、`collectFiles.js` 是「收集文件」、`build.js` 是「构建」。这条是踩过三次坑换来的（`ctx.js`、`rtable.js` 这种只有写的人懂的缩写，后来又变成 `-Transform` / `-Runner` / `-file` 三套后缀混用）。
- **`bin/` 和 `src/readWriteBin.js` 不是一回事**。`bin/` 是可执行入口目录（npm 惯例），`readWriteBin.js` 管 `.bin` 私有容器。

---

## 参与开发

### 三条硬规矩

1. **有现成的库就直接用，别自己造轮子。** 只有两种情况才自己写：没有现成实现，或者别人的实现压不出我们要的那串字节（`resources.index` 这种私有格式、`.bin` 私有容器，全世界只有华为的 C++ 代码会写它）。
2. **依赖要锁在能对上字节的版本上。** `jsrsasign` 的 ASN.1 编码不能随便升，升了要重新对一遍签名产物。
3. **每个模块必须有对照。** 改 `.bin` 就用真实文件往返比对 SHA256，改 config 就逐阶段对比 Gradle 产物。没有对照的改动不算完成。对照结论写在各自模块的注释里（「`R.txt` 73 B 字节一致」这种），改代码前先读那段，改完重跑一遍。

已经手写并验证过的（`readWriteZip.js`、`readWriteBin.js`、`writeResourceIndex.js`）**保持不动** —— 它们有对照基准是字节级 SHA256，换库就得重新对一遍，风险大于收益。`compressPng.js` 是例外：它的验收标准是像素一致，底层换成 `node:zlib` 没问题，但里面那些 libpng 的细节（按代价函数挑每行 filter、IDAT 按 8192 硬切）必须原样保留，改了压缩效果会退步。

### 加新步骤的步骤

1. 想清楚它插在 `src/build.js` 的哪两行之间 —— 没有依赖图，顺序就是代码顺序
2. 有实质逻辑就在 `src/` 下建 `<动词+名词>.js`；只有几行胶水就直接写在 `build.js` 里（`write bin`、`pack bin hap` 都是这么处理的）
3. 想让它能从命令行停在那个产物上，就在 `build.js` 的 `TARGETS` 里加一项、在 `bin/hmlwsdk.js` 的 `COMMANDS` 里加一条别名
4. 拿真实工程跑一遍，把产物字节数写进注释

### 重新验证 `.bc` 生成

`jerry-parser-wasm` 的产物是以 SDK 里的 `jerry-snapshot.exe` 为基准对齐的。换了 jerryscript 版本要重新验证时，先把那份 exe 拷回 `src/ace-loader/bin/`：

```bat
copy "%LOCALAPPDATA%\Huawei\Sdk\hmscore\2.2.0\js\build-tools\ace-loader\bin\jerry-snapshot.exe" src\ace-loader\bin\
```

（上面是 Windows 上的 SDK 常见位置，其它平台对应 DevEco 的 SDK 目录。）

SHA256 应为 `259A75D5972482CE712AE1696DB0E4B9D8B3A0C6334C524B811999BC3F0AB5EB`（310784 B）。

验法：拿一批真实 bundle，对这个 exe 和 wasm 各跑一次 `generate -o <out> <in>`，逐字节比。

⚠ **每生成一个 `.bc` 必须新建 emscripten 实例**。同一实例连续 `callMain` 时 jerry 内部堆不清零，实测 22 个文件里只有前 2 个正确、第 3 个起全部漂移（长度相同，24~89 个单字节不同）。

### 本地文档

仓库根目录的 `AGENTS.md` 和 `doc/gradle-build-report.html` 是**本地文档，不进 git**（`.gitignore` 里排除了）。它们记着：

- `AGENTS.md` —— 每个模块的完整格式档案、踩过的坑、验证样本清单。改格式相关逻辑前必读
- `doc/gradle-build-report.html` —— 72 张任务卡片的完整 Gradle 构建图。`src/build.js` 的步骤划分和每步的关键点都是从这张图里反推出来的

### 参考项目

| 目录 | 用途 |
|---|---|
| `hap-sign-utils/` | `.bin` 容器读写、签名、图片转 `.bin` 的来源。`src/readWriteBin.js` 和 `src/sign/` 都是在它基础上改造的 |
| `hmlw.pages.dev/tools/` | `.bin` 的只读解析逻辑（`getHapInfo.js` 等），用来交叉印证容器格式 |
| `apps/_empty/_empty` | 最小 liteWearable 工程，所有对照验证的基准 |
| `apps/devdemo/devdemo` | 同时有 `.bin` 形态和文件树形态的 hap，端到端基准 |
| `apps/atri-mdm`、`apps/_3rd/*` | 不同规模的样本工程 |

Gradle 插件 jar（要查 Gradle 具体行为时反编译它）：

```
~/.gradle/caches/modules-2/files-2.1/com.huawei.ohos/hap/3.1.5.0/*/hap-3.1.5.0-unshaded.jar
```

常用：`javap -p -c -classpath <jar> <类名>`，字符串常量在 `// String` 行里。

---

## License

ISC
