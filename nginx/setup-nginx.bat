@echo off

REM Get the directory where the script is located
SET SCRIPT_DIR=%~dp0

REM Run the Node.js manager script with the "setup" command
node "%SCRIPT_DIR%nginx-manager.js" setup
