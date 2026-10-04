@echo off
chcp 65001 >nul
title Push CMCC to GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0推送到GitHub.ps1"
