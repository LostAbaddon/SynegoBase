@echo off
REM This script controls the Nginx service by calling the synegobase library.
node -e "require('__SYNEGOBASE_PATH__').controlNginx('start')"
