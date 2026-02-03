#!/usr/bin/env node
// filepath: /Users/darshanbmehta/eb1/batch-cli.js
// Command Line Interface for Enhanced Batch SSRN Downloader

import { runEnhancedBatch } from "./enhanced-batch-downloader.js";
import fs from "fs";
import path from "path";

// Parse command line arguments
const args = process.argv.slice(2);
let configFile = "batch-config.json";
let urlsFile = "urls-to-download.txt";
let generateUrls = false;
let urlCount = 100;

// Simple argument parsing
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--config':
    case '-c':
      configFile = args[++i];
      break;
    case '--urls':
    case '-u':
      urlsFile = args[++i];
      break;
    case '--generate':
    case '-g':
      generateUrls = true;
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        urlCount = parseInt(args[++i]) || 100;
      }
      break;
    case '--help':
    case '-h':
      showHelp();
      process.exit(0);
    default:
      console.log(`Unknown option: ${args[i]}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
🚀 Enhanced Batch SSRN Downloader CLI

Usage: node batch-cli.js [options]

Options:
  -c, --config <file>     Configuration file (default: batch-config.json)
  -u, --urls <file>       URLs file (default: urls-to-download.txt)  
  -g, --generate [count]  Generate random SSRN URLs (default: 100)
  -h, --help              Show this help message

Examples:
  node batch-cli.js                                    # Use default files
  node batch-cli.js -u my-papers.txt                 # Custom URLs file
  node batch-cli.js -g 50                            # Generate 50 random URLs
  node batch-cli.js -c custom-config.json -u papers.txt  # Custom config + URLs

Configuration File (batch-config.json):
{
  "batchConfig": {
    "useProxies": true,
    "maxConcurrent": 3,
    "delayBetweenRequests": 10000,
    "maxRetries": 2
  }
}

URLs File Format (urls-to-download.txt):
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5424002
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5423950
# Lines starting with # are ignored
`);
}

async function loadConfig(configPath) {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log(`✅ Loaded configuration from ${configPath}`);
      return config;
    } else {
      console.log(`⚠️ Config file ${configPath} not found, using defaults`);
      return {};
    }
  } catch (error) {
    console.log(`❌ Error loading config: ${error.message}`);
    return {};
  }
}

function loadUrls(urlsPath) {
  try {
    if (fs.existsSync(urlsPath)) {
      const content = fs.readFileSync(urlsPath, 'utf8');
      const urls = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('papers.ssrn.com'));
      
      console.log(`✅ Loaded ${urls.length} URLs from ${urlsPath}`);
      return urls;
    } else {
      console.log(`⚠️ URLs file ${urlsPath} not found`);
      return [];
    }
  } catch (error) {
    console.log(`❌ Error loading URLs: ${error.message}`);
    return [];
  }
}

function generateRandomUrls(count) {
  console.log(`🎲 Generating ${count} random SSRN URLs...`);
  const baseId = 5424002;
  const urls = [];
  
  for (let i = 0; i < count; i++) {
    // Generate varied paper IDs
    const paperId = baseId - (i * 75) + Math.floor(Math.random() * 100) - 50;
    urls.push(`https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${paperId}`);
  }
  
  return urls;
}

async function main() {
  console.log("🚀 Enhanced Batch SSRN Downloader CLI");
  console.log("=" + "=".repeat(50));
  
  // Load configuration
  const config = await loadConfig(configFile);
  const batchOptions = {
    useProxies: true,
    maxConcurrent: 3,
    delayBetweenRequests: 10000,
    ...config.batchConfig
  };
  
  // Load or generate URLs
  let urls = [];
  
  if (generateUrls) {
    urls = generateRandomUrls(urlCount);
  } else {
    urls = loadUrls(urlsFile);
    
    if (urls.length === 0) {
      console.log("❌ No URLs found. Generate some URLs or check your URLs file.");
      console.log("💡 Try: node batch-cli.js --generate 10");
      process.exit(1);
    }
  }
  
  console.log(`\n📊 Batch Configuration:`);
  console.log(`   📥 URLs to process: ${urls.length}`);
  console.log(`   🔄 Use proxies: ${batchOptions.useProxies ? 'Yes' : 'No'}`);
  console.log(`   ⚡ Max concurrent: ${batchOptions.maxConcurrent}`);
  console.log(`   ⏱️  Delay between batches: ${batchOptions.delayBetweenRequests}ms`);
  console.log(`   🚫 Retries: None (one proxy per URL)`);
  console.log("=" + "=".repeat(50));
  
  // Confirm before starting
  if (urls.length > 10) {
    console.log(`\n⚠️  About to process ${urls.length} URLs. This may take a while.`);
    console.log("⏱️  Estimated time: ~" + Math.ceil(urls.length * 30 / 60) + " minutes");
    console.log("💡 Press Ctrl+C to cancel, or wait 5 seconds to continue...");
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log("🚦 Starting batch download...\n");
  }
  
  try {
    // Run the enhanced batch downloader
    const results = await runEnhancedBatch(urls, batchOptions);
    
    // Final summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log("\n🎯 FINAL SUMMARY:");
    console.log(`✅ Successful: ${successCount}/${urls.length} (${((successCount/urls.length)*100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${failCount}/${urls.length} (${((failCount/urls.length)*100).toFixed(1)}%)`);
    
    if (successCount > 0) {
      console.log(`📁 Files saved to: ./downloads/`);
      console.log(`📊 Report saved to: ./downloads/enhanced-batch-report-*.csv`);
    }
    
    console.log("\n✨ Batch processing complete!");
    
  } catch (error) {
    console.error("💥 Batch processing failed:", error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the CLI
main().catch(error => {
  console.error("💥 CLI Error:", error.message);
  process.exit(1);
});
