@echo off
REM This script starts the Gemini RAG Studio application and opens it in a full-screen browser window.

REM Step 1: Start the development server in a new command prompt window.
REM The /k flag keeps the new command prompt window open after npm start finishes.
REM This allows you to see the server logs and stop it with Ctrl+C.
echo Starting Gemini RAG Studio server...
start cmd /k npm start

REM Step 2: Wait for the server to initialize.
REM This is a crucial step to ensure the application is ready before the browser tries to open it.
REM Adjust the timeout duration (in seconds) if the server takes longer to start on your machine.
echo Waiting for the server to start (15 seconds)...
timeout /t 15 > nul

REM The application will now open automatically via Electron.
echo Electron application is starting...

echo Script finished. The server is running in the separate command prompt window.
echo Close that window or press Ctrl+C in it to stop the server.