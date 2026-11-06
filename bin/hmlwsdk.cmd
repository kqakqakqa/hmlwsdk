@echo off
rem hmlwsdk launcher for cmd / PowerShell.
rem
rem Windows does not honor shebangs and does not treat .js as executable, so adding
rem bin/ to PATH alone is not enough (npm link generates a similar shim, but only for
rem a global install). This file is that shim.
rem
rem Keep this file ASCII-only: cmd parses it in the OEM code page, and UTF-8 Chinese
rem comments decode into garbage that cmd tries to execute. The Chinese explanation
rem lives in README.md and AGENTS.md instead.
rem
rem %~dp0 is the directory of this script, with a trailing backslash.
node "%~dp0hmlwsdk.js" %*
