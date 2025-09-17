#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(color + message + colors.reset);
}

function checkNodeModules() {
  if (!fs.existsSync('node_modules')) {
    log('📦 Installing dependencies...', colors.yellow);
    execSync('npm install', { stdio: 'inherit' });
  }
}

function checkModelFiles() {
  const modelPath = path.join('public', 'models', 'Xenova', 'all-MiniLM-L6-v2');
  
  if (!fs.existsSync(modelPath)) {
    log('🤖 Model files not found. Downloading required models...', colors.yellow);
    
    // Create the directory if it doesn't exist
    const publicModelsDir = path.join('public', 'models');
    if (!fs.existsSync(publicModelsDir)) {
      fs.mkdirSync(publicModelsDir, { recursive: true });
    }
    
    try {
      log('   Cloning Xenova/all-MiniLM-L6-v2 model...', colors.cyan);
      execSync(
        'git clone https://huggingface.co/Xenova/all-MiniLM-L6-v2 public/models/Xenova/all-MiniLM-L6-v2',
        { stdio: 'inherit' }
      );
      log('✅ Model files downloaded successfully!', colors.green);
    } catch (error) {
      log('❌ Failed to download model files. Please run manually:', colors.red);
      log('   git clone https://huggingface.co/Xenova/all-MiniLM-L6-v2 public/models/Xenova/all-MiniLM-L6-v2', colors.cyan);
      process.exit(1);
    }
  } else {
    log('✅ Model files found', colors.green);
  }
}

function checkEnvironment() {
  const envFile = '.env.local';
  if (!fs.existsSync(envFile)) {
    log('⚠️  .env.local file not found', colors.yellow);
    log('   You may need to create it with your Gemini API key:', colors.yellow);
    log('   REACT_APP_GEMINI_API_KEY=your_api_key_here', colors.cyan);
  } else {
    const envContent = fs.readFileSync(envFile, 'utf8');
    if (!envContent.includes('REACT_APP_GEMINI_API_KEY') && !envContent.includes('VITE_GEMINI_API_KEY')) {
      log('⚠️  No Gemini API key found in .env.local', colors.yellow);
      log('   Add your API key: VITE_GEMINI_API_KEY=your_api_key_here', colors.cyan);
    } else {
      log('✅ Environment configuration found', colors.green);
    }
  }
}

function startDevServer() {
  log('\n🚀 Starting Gemini RAG Studio...', colors.bright + colors.green);
  
  const viteProcess = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  
  viteProcess.on('error', (error) => {
    log('❌ Failed to start development server:', colors.red);
    log(error.message, colors.red);
    process.exit(1);
  });
  
  viteProcess.on('close', (code) => {
    if (code !== 0) {
      log(`❌ Development server exited with code ${code}`, colors.red);
    }
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('\n🛑 Shutting down...', colors.yellow);
    viteProcess.kill('SIGINT');
  });
  
  process.on('SIGTERM', () => {
    viteProcess.kill('SIGTERM');
  });
}

function displayWelcome() {
  console.clear();
  log('╔══════════════════════════════════════════╗', colors.cyan);
  log('║         Gemini RAG Studio Startup        ║', colors.cyan);
  log('╚══════════════════════════════════════════╝', colors.cyan);
  log('');
  log('🔍 Checking prerequisites...', colors.blue);
}

function displayInfo() {
  log('\n📋 Application Info:', colors.bright);
  log('   • 100% Client-side RAG application', colors.cyan);
  log('   • Drag & drop files or folders to index', colors.cyan);
  log('   • Chat with Gemini about your documents', colors.cyan);
  log('   • All processing happens in your browser', colors.cyan);
  log('\n💡 Tips:', colors.bright);
  log('   • Make sure you have a Gemini API key configured', colors.yellow);
  log('   • The app will open automatically in your browser', colors.yellow);
  log('   • Press Ctrl+C to stop the server', colors.yellow);
  log('');
}

async function main() {
  try {
    displayWelcome();
    
    // Check all prerequisites
    checkNodeModules();
    checkModelFiles();
    checkEnvironment();
    
    displayInfo();
    
    // Start the development server
    startDevServer();
    
  } catch (error) {
    log('❌ Startup failed:', colors.red);
    log(error.message, colors.red);
    process.exit(1);
  }
}

main();