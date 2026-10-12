@echo off
REM RetrainWise launcher for Windows.
REM Creates a virtual environment OUTSIDE the project folder (%LOCALAPPDATA%\RetrainWise\venv),
REM installs the pinned requirements once, then runs:  streamlit run app.py
setlocal
cd /d "%~dp0"
set "VENV=%LOCALAPPDATA%\RetrainWise\venv"
set PYTHONDONTWRITEBYTECODE=1

if not exist "%VENV%\Scripts\python.exe" (
    echo Creating virtual environment in "%VENV%" ...
    where py >nul 2>nul && (py -3 -m venv "%VENV%") || (python -m venv "%VENV%")
    if errorlevel 1 (
        echo Could not create a virtual environment. Install Python 3.10-3.12 from python.org and retry.
        pause
        exit /b 1
    )
    "%VENV%\Scripts\python.exe" -m pip install --upgrade pip
    "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Dependency installation failed. See the messages above.
        pause
        exit /b 1
    )
)

"%VENV%\Scripts\python.exe" -m streamlit run app.py
pause
