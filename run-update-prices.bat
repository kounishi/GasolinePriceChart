@echo off
chcp 65001 >nul 2>&1
rem Node は UTF-8 で出力するため、cmd 側も UTF-8 に揃えて混在による文字化けを防ぐ。
rem chcp が効かない環境でも壊れないよう、このバッチ自身の echo 行は ASCII のみに留める。
cd /d C:\Users\cores\source\repos\GasolinePriceChart
if not exist logs mkdir logs
set LOG=logs\update-prices.log
echo ============================================================>> "%LOG%"
echo [%date% %time%] START update-prices>> "%LOG%"
rem npm は npm.cmd なので call が必須。call なしだと以降の行が実行されない。
call npm run update-prices>> "%LOG%" 2>&1
set EXITCODE=%ERRORLEVEL%
echo [%date% %time%] END update-prices (exit=%EXITCODE%)>> "%LOG%"
rem タスクスケジューラの「最終実行結果」に失敗を残すため終了コードを維持する。
exit /b %EXITCODE%
