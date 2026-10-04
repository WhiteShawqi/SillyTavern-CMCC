@echo off
chcp 65001 >nul
title 推送 CMCC 到 GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0推送到GitHub.ps1"
