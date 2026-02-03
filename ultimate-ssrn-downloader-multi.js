// Ultimate SSRN Downloader - Captures ALL Download URLs
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { scrapeProxies } from "./proxies.js";

// Global state for tracking active browsers and shutdown management
const activeBrowsers = new Set();
const activeDownloads = new Map();
let isShuttingDown = false;
let shutdownInProgress = false;

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  if (shutdownInProgress) {
    console.log(`\n⚠️  Shutdown already in progress (${signal}), forcing exit...`);
    process.exit(1);
  }
  
  shutdownInProgress = true;
  console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);
  console.log(`📊 Active browsers: ${activeBrowsers.size}`);
  console.log(`📊 Active downloads: ${activeDownloads.size}`);
  
  // Set shutdown flag to prevent new downloads
  isShuttingDown = true;
  
  try {
    // Wait for active downloads to complete (max 10 seconds)
    console.log("⏳ Waiting for active downloads to complete...");
    let waitTime = 0;
    const maxWaitTime = 10000; // 10 seconds
    
    while (activeDownloads.size > 0 && waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 500));
      waitTime += 500;
      
      if (waitTime % 2000 === 0) {
        console.log(`⏳ Still waiting... (${activeDownloads.size} downloads active)`);
      }
    }
    
    // Close all active browsers
    console.log("🔄 Closing all browser instances...");
    const closeBrowserPromises = Array.from(activeBrowsers).map(async (browser) => {
      try {
        if (browser && !browser._closed) {
          await browser.close();
          console.log("✅ Browser closed successfully");
        }
      } catch (error) {
        console.log("⚠️  Error closing browser:", error.message);
      }
    });
    
    await Promise.allSettled(closeBrowserPromises);
    activeBrowsers.clear();
    
    console.log("✅ Graceful shutdown complete");
    process.exit(0);
    
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
};

// Register signal handlers for graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught exceptions and promise rejections
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Enhanced Logging System for Success Tracking
class SuccessLogger {
  constructor() {
    this.logDir = '/Users/darshanbmehta/eb1/logs';
    this.successLogFile = path.join(this.logDir, 'successful-downloads.log');
    this.summaryLogFile = path.join(this.logDir, 'download-summary.log');
    this.statsFile = path.join(this.logDir, 'download-stats.json');
    
    // Ensure logs directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`✅ Created logs directory: ${this.logDir}`);
    }
    
    // Initialize log files if they don't exist
    this.initializeLogFiles();
  }
  
  initializeLogFiles() {
    const timestamp = new Date().toISOString();
    
    // Initialize success log with headers
    if (!fs.existsSync(this.successLogFile)) {
      const header = `# SSRN Downloader - Successful Downloads Log\n` +
                    `# Started: ${timestamp}\n` +
                    `# Format: [TIMESTAMP] SUCCESS: Paper ID | Filename | Size | Duration | Proxy | Instance\n\n`;
      fs.writeFileSync(this.successLogFile, header);
    }
    
    // Initialize summary log
    if (!fs.existsSync(this.summaryLogFile)) {
      const header = `# SSRN Downloader - Session Summary Log\n` +
                    `# Started: ${timestamp}\n\n`;
      fs.writeFileSync(this.summaryLogFile, header);
    }
  }
  
  logSuccess(downloadInfo) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] SUCCESS: Paper ${downloadInfo.paperId} | ` +
                    `${downloadInfo.filename} | ${(downloadInfo.size / 1024 / 1024).toFixed(2)}MB | ` +
                    `${downloadInfo.duration}s | ${downloadInfo.proxy || 'no-proxy'} | ` +
                    `Instance ${downloadInfo.instanceId}\n`;
    
    // Append to success log
    fs.appendFileSync(this.successLogFile, logEntry);
    
    // Update stats
    this.updateStats(downloadInfo);
    
    console.log(`📝 Logged success: ${downloadInfo.filename}`);
  }
  
  logBatchSummary(batchNum, batchResults) {
    const timestamp = new Date().toISOString();
    const successful = batchResults.filter(r => r.success).length;
    const failed = batchResults.filter(r => !r.success).length;
    const totalSize = batchResults
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.size || 0), 0);
    
    const summaryEntry = `[${timestamp}] BATCH ${batchNum}: ` +
                        `${successful} successful, ${failed} failed, ` +
                        `${(totalSize / 1024 / 1024).toFixed(2)}MB total\n`;
    
    fs.appendFileSync(this.summaryLogFile, summaryEntry);
  }
  
  updateStats(downloadInfo) {
    let stats = {};
    
    // Load existing stats if file exists
    if (fs.existsSync(this.statsFile)) {
      try {
        const statsData = fs.readFileSync(this.statsFile, 'utf8');
        stats = JSON.parse(statsData);
      } catch (error) {
        console.log('⚠️ Could not parse existing stats, starting fresh');
      }
    }
    
    // Initialize stats structure
    if (!stats.totalDownloads) stats.totalDownloads = 0;
    if (!stats.totalSize) stats.totalSize = 0;
    if (!stats.paperIds) stats.paperIds = {};
    if (!stats.paperSuccessCount) stats.paperSuccessCount = {};
    if (!stats.proxies) stats.proxies = {};
    if (!stats.sessions) stats.sessions = [];
    if (!stats.lastUpdated) stats.lastUpdated = null;
    
    // Update stats
    stats.totalDownloads++;
    stats.totalSize += downloadInfo.size;
    stats.lastUpdated = new Date().toISOString();
    
    // Track paper IDs
    if (!stats.paperIds[downloadInfo.paperId]) {
      stats.paperIds[downloadInfo.paperId] = 0;
    }
    stats.paperIds[downloadInfo.paperId]++;
    
    // Track count of successful hits per paper ID (new requirement)
    if (!stats.paperSuccessCount[downloadInfo.paperId]) {
      stats.paperSuccessCount[downloadInfo.paperId] = 0;
    }
    stats.paperSuccessCount[downloadInfo.paperId]++;
    
    // Track proxy performance
    if (downloadInfo.proxy) {
      if (!stats.proxies[downloadInfo.proxy]) {
        stats.proxies[downloadInfo.proxy] = {
          successes: 0,
          totalTime: 0,
          avgTime: 0
        };
      }
      stats.proxies[downloadInfo.proxy].successes++;
      stats.proxies[downloadInfo.proxy].totalTime += parseFloat(downloadInfo.duration);
      stats.proxies[downloadInfo.proxy].avgTime = 
        stats.proxies[downloadInfo.proxy].totalTime / stats.proxies[downloadInfo.proxy].successes;
    }
    
    // Save updated stats
    fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
  }
  
  logSessionStart(config) {
    const timestamp = new Date().toISOString();
    const sessionEntry = `[${timestamp}] SESSION START: Target ${config.targetDownloads} downloads, ` +
                         `Batch size ${config.batchSize}, Concurrent instances ${config.concurrentInstances}\n`;
    
    fs.appendFileSync(this.summaryLogFile, sessionEntry);
    console.log(`📝 Session logged: ${config.targetDownloads} target downloads`);
  }
  
  logSessionEnd(finalStats) {
    const timestamp = new Date().toISOString();
    const sessionEntry = `[${timestamp}] SESSION END: ` +
                         `${finalStats.successCount} successful (${finalStats.successRate}%), ` +
                         `${finalStats.failCount} failed, ` +
                         `${finalStats.totalTime} minutes total, ` +
                         `${(finalStats.totalSize / 1024 / 1024).toFixed(2)}MB downloaded\n\n`;
    
    fs.appendFileSync(this.summaryLogFile, sessionEntry);
    console.log(`📝 Session completed and logged`);
  }
  
  getStats() {
    if (!fs.existsSync(this.statsFile)) {
      return {
        totalDownloads: 0,
        totalSize: 0,
        paperIds: {},
        proxies: {},
        lastUpdated: null
      };
    }
    
    try {
      const statsData = fs.readFileSync(this.statsFile, 'utf8');
      return JSON.parse(statsData);
    } catch (error) {
      console.log('⚠️ Error reading stats file');
      return { totalDownloads: 0, totalSize: 0 };
    }
  }
  
  printCurrentStats() {
    const stats = this.getStats();
    console.log(`\n📊 Current Session Stats:`);
    console.log(`✅ Total Downloads: ${stats.totalDownloads}`);
    console.log(`📁 Total Size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📄 Paper IDs: ${Object.keys(stats.paperIds).length} different papers`);
    console.log(`🌐 Active Proxies: ${Object.keys(stats.proxies).length}`);
    if (stats.lastUpdated) {
      console.log(`🕐 Last Updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
    }
  }

  logAttempt(downloadInfo) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ATTEMPT: Paper ${downloadInfo.paperId} | Proxy: ${downloadInfo.proxy || 'no-proxy'} | Instance ${downloadInfo.instanceId}\n`;
    fs.appendFileSync(this.successLogFile, logEntry);
    // Optionally, update stats for attempts
    this.updateAttemptStats(downloadInfo);
  }

  updateAttemptStats(downloadInfo) {
    let stats = {};
    if (fs.existsSync(this.statsFile)) {
      try {
        const statsData = fs.readFileSync(this.statsFile, 'utf8');
        stats = JSON.parse(statsData);
      } catch (error) {
        console.log('⚠️ Could not parse existing stats, starting fresh');
      }
    }
    if (!stats.attempts) stats.attempts = {};
    if (!stats.attempts[downloadInfo.proxy]) stats.attempts[downloadInfo.proxy] = [];
    if (!stats.attempts[downloadInfo.proxy].includes(downloadInfo.paperId)) {
      stats.attempts[downloadInfo.proxy].push(downloadInfo.paperId);
    }
    fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
  }

  // Logs a summary showing which proxies succeeded for 5424002 and for other paper IDs
  logProxyPaperSummary() {
    let stats = {};
    if (fs.existsSync(this.statsFile)) {
      try {
        const statsData = fs.readFileSync(this.statsFile, 'utf8');
        stats = JSON.parse(statsData);
      } catch (error) {
        fs.appendFileSync(this.summaryLogFile, '\n[ProxyPaperSummary] Could not parse stats file.\n');
        return;
      }
    } else {
      fs.appendFileSync(this.summaryLogFile, '\n[ProxyPaperSummary] Stats file not found.\n');
      return;
    }

    const attempts = stats.attempts || {};
    const paperIds = Object.keys(stats.paperSuccessCount || {});
    const summaryLines = [];
    summaryLines.push('\n# Proxy-Paper Success Summary');
    summaryLines.push('Proxy | 5424002 | Other Paper IDs | Success Count Per Paper');
    summaryLines.push('------|---------|----------------|------------------------');
    for (const [proxy, attemptedPapers] of Object.entries(attempts)) {
      const has5424002 = attemptedPapers.includes(5424002);
      const otherPapers = attemptedPapers.filter(id => id !== 5424002);
      // Count per paper for this proxy
      const perPaperCounts = {};
      for (const pid of attemptedPapers) {
        const key = proxy + '_' + pid;
        if (stats.proxies && stats.proxies[proxy] && stats.proxies[proxy][key]) {
          perPaperCounts[pid] = stats.proxies[proxy][key];
        }
      }
      summaryLines.push(`${proxy} | ${has5424002 ? 'YES' : 'NO'} | ${otherPapers.length > 0 ? otherPapers.join(',') : '-'} | ${attemptedPapers.map(pid => pid + ':' + (perPaperCounts[pid] || '?')).join(', ')}`);
    }
    // Add total count per paper id
    summaryLines.push('\n# Total Successful Downloads Per Paper ID:');
    for (const pid of paperIds) {
      summaryLines.push(`Paper ${pid}: ${stats.paperSuccessCount[pid]}`);
    }
    summaryLines.push('\n# Ideally, if a proxy works for 5424002, it should work for all.');
    fs.appendFileSync(this.summaryLogFile, summaryLines.join('\n') + '\n');
  }
}

// Enhanced Proxy Manager with Success Tracking and Affinity
class ProxyManager {
  constructor() {
    this.proxies = [];
    this.failedProxies = new Set();
    this.successfulProxies = new Set(); // Track proxies that worked
    this.proxySuccessCount = new Map(); // Count successes per proxy
    this.proxyPaperHistory = new Map(); // Track which papers each proxy worked for
    this.proxyPaperIndex = new Map(); // Track next paper index for each proxy
    this.currentIndex = 0;
    this.preferSuccessful = true; // Prefer previously successful proxies
  }

  // Optimization: Only fetch proxies if list is empty or 5 minutes have passed since last fetch
  async loadProxies() {
    const now = Date.now();
    if (!this.lastFetchTime) this.lastFetchTime = 0;
    const fiveMinutes = 5 * 60 * 1000;
    // Only reload if proxies are empty, or we've gone through all, or 5min passed
    const needReload =
      this.proxies.length === 0 ||
      this.currentIndex === 0 && this.lastFetchTime && (now - this.lastFetchTime > fiveMinutes);
    if (needReload) {
      console.log('🔄 Loading fresh proxies...');
      this.proxies = await scrapeProxies();
      this.failedProxies.clear();
      this.currentIndex = 0;
      this.lastFetchTime = now;
      console.log(`✅ Loaded ${this.proxies.length} proxies`);
      console.log(`🎯 Previously successful proxies: ${this.successfulProxies.size}`);
      return this.proxies.length > 0;
    } else {
      console.log('⏳ Using cached proxies, not reloading yet.');
      return this.proxies.length > 0;
    }
  }

  getNextProxy() {
    if (this.proxies.length === 0) {
      return null;
    }

    // Strategy 1: Prefer previously successful proxies (for any paper)
    if (this.preferSuccessful && this.successfulProxies.size > 0) {
      const successfulArray = Array.from(this.successfulProxies).filter(proxy => 
        !this.failedProxies.has(proxy) && this.proxies.includes(proxy)
      );
      
      if (successfulArray.length > 0) {
        // Sort by success count (most successful first)
        successfulArray.sort((a, b) => 
          (this.proxySuccessCount.get(b) || 0) - (this.proxySuccessCount.get(a) || 0)
        );
        
        const chosenProxy = successfulArray[0];
        console.log(`⭐ Using successful proxy ${chosenProxy} - ${this.proxySuccessCount.get(chosenProxy)} previous successes`);
        return chosenProxy;
      }
    }

    // Strategy 2: Standard rotation for untested proxies
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      
      if (!this.failedProxies.has(proxy)) {
        console.log(`🔄 Using fresh proxy ${proxy} for testing`);
        return proxy;
      }
      attempts++;
    }

    // Strategy 3: If all proxies failed, reset and try successful ones again
    if (this.failedProxies.size === this.proxies.length) {
      console.log('⚠️ All proxies failed, resetting failure list but keeping success history');
      this.failedProxies.clear();
      
      // Try the most successful proxy first
      if (this.successfulProxies.size > 0) {
        const bestProxy = Array.from(this.successfulProxies)
          .sort((a, b) => (this.proxySuccessCount.get(b) || 0) - (this.proxySuccessCount.get(a) || 0))[0];
        console.log(`🔄 Retrying best proxy: ${bestProxy}`);
        return bestProxy;
      }
      
      return this.proxies[0];
    }

    return null;
  }

  markProxyFailed(proxy) {
    this.failedProxies.add(proxy);
    console.log(`❌ Marked proxy as failed: ${proxy} (${this.failedProxies.size}/${this.proxies.length} failed)`);
  }

  markProxySuccessful(proxy, paperId) {
    this.successfulProxies.add(proxy);
    
    // Increment total success count for this proxy
    const currentCount = this.proxySuccessCount.get(proxy) || 0;
    this.proxySuccessCount.set(proxy, currentCount + 1);
    
    // Track individual paper success count for better cycling
    const paperKey = proxy + '_' + paperId;
    const paperCount = this.proxySuccessCount.get(paperKey) || 0;
    this.proxySuccessCount.set(paperKey, paperCount + 1);
    
    // Track paper association
    if (!this.proxyPaperHistory.has(proxy)) {
      this.proxyPaperHistory.set(proxy, new Set());
    }
    this.proxyPaperHistory.get(proxy).add(paperId);
    
    console.log(`✅ Marked proxy as successful: ${proxy.substring(0, 15)}... - ${currentCount + 1} total successes, ${paperCount + 1} successes for paper ${paperId}`);
  }

  // New method: Mark proxy as successful for navigation (even if download fails)
  markProxyNavigationSuccessful(proxy, paperId) {
    this.successfulProxies.add(proxy);
    
    // Track paper association for navigation success
    if (!this.proxyPaperHistory.has(proxy)) {
      this.proxyPaperHistory.set(proxy, new Set());
    }
    this.proxyPaperHistory.get(proxy).add(paperId);
    
    console.log(`🌐 Marked proxy navigation successful: ${proxy} - can navigate to paper ${paperId}`);
  }

  getProxyForPaper(paperId) {
    // Get best proxy for specific paper
    const candidates = [];
    
    for (const [proxy, papers] of this.proxyPaperHistory.entries()) {
      if (papers.has(paperId) && !this.failedProxies.has(proxy) && this.proxies.includes(proxy)) {
        candidates.push({
          proxy,
          successCount: this.proxySuccessCount.get(proxy) || 0
        });
      }
    }
    
    if (candidates.length > 0) {
      // Return proxy with most successes for this paper
      candidates.sort((a, b) => b.successCount - a.successCount);
      return candidates[0].proxy;
    }
    
    return null;
  }

  selectPaperIdForProxy(proxy, primaryPaperId, alternativePaperIds) {
    if (!proxy) {
      return primaryPaperId; // Default to primary if no proxy
    }

    // Check if this proxy has already succeeded with the primary paper ID
    const proxyHistory = this.proxyPaperHistory.get(proxy);
    const hasSucceededWithPrimary = proxyHistory && proxyHistory.has(primaryPaperId);
    
    if (!hasSucceededWithPrimary) {
      // Proxy hasn't succeeded with primary paper ID yet, so use primary
      console.log(`🎯 Using primary paper ${primaryPaperId} for proxy ${proxy.substring(0, 15)}... (not yet tested/succeeded)`);
      return primaryPaperId;
    }
    
    // Proxy has succeeded with primary, now cycle through ALL alternative paper IDs
    // Find unused alternatives first, then cycle through all systematically
    const unusedAlternatives = alternativePaperIds.filter(id => !proxyHistory.has(id));
    
    if (unusedAlternatives.length > 0) {
      // Pick the next unused alternative in sequence
      const nextAltPaperId = unusedAlternatives[0];
      console.log(`🎯 Using alternative paper ${nextAltPaperId} for successful proxy ${proxy.substring(0, 15)}... (${unusedAlternatives.length} alternatives remaining)`);
      return nextAltPaperId;
    }
    
    // All alternatives have been tried, now cycle through ALL papers (including alternatives) systematically
    // This ensures we use ALL paper IDs, not just cycle back to primary
    const allPaperIds = [primaryPaperId, ...alternativePaperIds];
    const successCounts = new Map();
    
    // Count how many times each paper ID has been used with this proxy
    for (const paperId of allPaperIds) {
      successCounts.set(paperId, this.proxySuccessCount.get(proxy + '_' + paperId) || 0);
    }
    
    // Find the paper ID with the least usage for this proxy
    const leastUsedPaper = allPaperIds.reduce((min, current) => 
      (successCounts.get(current) < successCounts.get(min)) ? current : min
    );
    
    console.log(`🔄 Cycling to least used paper ${leastUsedPaper} for proxy ${proxy.substring(0, 15)}... (all alternatives tested)`);
    return leastUsedPaper;
  }

  // Returns the next paper ID for a proxy, cycling through all, always starting from 5424002 after each cycle
  getNextPaperIdForProxy(proxy, primaryPaperId, alternativePaperIds) {
    if (!proxy) return primaryPaperId;
    const allPaperIds = [primaryPaperId, ...alternativePaperIds];
    let idx = this.proxyPaperIndex.get(proxy) || 0;
    const paperId = allPaperIds[idx];
    // Advance index for next time
    idx = (idx + 1) % allPaperIds.length;
    this.proxyPaperIndex.set(proxy, idx);
    return paperId;
  }

  getStats() {
    return {
      total: this.proxies.length,
      failed: this.failedProxies.size,
      successful: this.successfulProxies.size,
      working: this.proxies.length - this.failedProxies.size,
      avgSuccessRate: this.successfulProxies.size > 0 ? 
        Array.from(this.proxySuccessCount.values()).reduce((a, b) => a + b, 0) / this.successfulProxies.size : 0
    };
  }
}

class UltimateSSRNDownloader {
  constructor(proxy = null, instanceId = 1) {
    this.allUrls = [];
    this.pdfUrls = [];
    this.cookies = "";
    this.downloadAttempted = false;
    this.paperId = null;
    this.proxy = proxy;
    this.instanceId = instanceId;
  }

  // Reset state for each new paper download
  resetState() {
    this.allUrls = [];
    this.pdfUrls = [];
    this.cookies = "";
    this.downloadAttempted = false;
    console.log("🔄 State reset for new paper download");
  }

  // Extract paper ID from URL
  extractPaperId(paperUrl) {
    const match = paperUrl.match(/abstract_id=(\d+)/);
    return match ? match[1] : 'unknown';
  }

  // Enhanced stealth configuration
  async configureStealth(page) {
    // Advanced stealth techniques from mainFS3.js
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', { 
        get: () => undefined 
      });
      
      // Mock chrome runtime
      window.chrome = { 
        runtime: {},
        app: {
          isInstalled: false
        }
      };
      
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', { 
        get: () => [1, 2, 3, 4, 5] 
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', { 
        get: () => ['en-US', 'en'] 
      });
      
      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Override the plugin array
      const pluginArray = [
        {
          0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin },
          description: "Portable Document Format",
          filename: "internal-pdf-viewer",
          length: 1,
          name: "Chrome PDF Plugin"
        }
      ];
      
      Object.defineProperty(navigator, 'plugins', {
        get: () => pluginArray
      });
    });
  }

  async download(paperUrl) {
    // Reset state to ensure fresh URLs are fetched for this paper
    // CRITICAL: AWS signed URLs expire every 300 seconds (5 minutes)
    // Each download MUST get a fresh URL to avoid expiration errors
    this.resetState();
    
    // Extract paper ID for proper filename
    const extractedId = this.extractPaperId(paperUrl);
    if (extractedId) {
      this.paperId = extractedId;
      console.log(`📋 [Instance ${this.instanceId}] Paper ID: ${extractedId}`);
      console.log(`⏰ [Instance ${this.instanceId}] Fresh AWS URL fetch required - URLs expire every 300 seconds`);
    }
    
    const proxyInfo = this.proxy ? `via proxy ${this.proxy}` : 'without proxy';
    console.log(`🚀 [Instance ${this.instanceId}] Ultimate SSRN Downloader - Capturing ALL URLs ${proxyInfo}`);
    
    // Enhanced browser launch args with proxy and stealth
    const browserArgs = [
      "--no-sandbox", 
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-field-trial-config",
      "--disable-hang-monitor",
      "--disable-ipc-flooding-protection",
      "--no-default-browser-check",
      "--no-first-run",
      "--incognito"
    ];

    // Add proxy if provided
    if (this.proxy) {
      browserArgs.push(`--proxy-server=http://${this.proxy}`);
    }

    const browser = await puppeteer.launch({
      headless: true, // Run headless for better performance with proxies
      args: browserArgs,
      executablePath: puppeteer.executablePath()
    });
    
    // Track active browser for shutdown management
    activeBrowsers.add(browser);
    
    try {
      const page = await browser.newPage();

      // Set Puppeteer download directory explicitly to avoid system Downloads folder
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: '/Users/darshanbmehta/eb1/downloads'
      });
      
      // Enhanced stealth configuration
      await this.configureStealth(page);
      
      // Set realistic user agent and viewport with randomization
      const userAgents = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
      ];
      
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
      await page.setUserAgent(randomUA);
      
      // Randomize viewport
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 }
      ];
      const randomViewport = viewports[Math.floor(Math.random() * viewports.length)];
      await page.setViewport(randomViewport);
      
      // Set extra headers for better stealth
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1'
      });
      
      // Monitor ALL network activity - capture EVERY URL
      await page.setRequestInterception(true);
      
      page.on('request', request => {
        const url = request.url();
        this.allUrls.push(url);
        
        // Check for potential PDF URLs
        if (url.includes('.pdf') || url.includes('download.ssrn.com') || url.includes('amazonaws.com')) {
          console.log(`📥 POTENTIAL PDF REQUEST: ${url}`);
          this.pdfUrls.push(url);
        }
        
        request.continue();
      });
      
      page.on('response', async response => {
        const url = response.url();
        const status = response.status();
        const contentType = response.headers()['content-type'] || '';
        
        // Capture PDF responses
        if (contentType.includes('application/pdf') && status === 200) {
          console.log(`🎯 PDF RESPONSE DETECTED!`);
          console.log(`🔗 URL: ${url}`);
          console.log(`📊 Status: ${status}`);
          console.log(`📋 Content-Type: ${contentType}`);
          
          if (!this.downloadAttempted) {
            this.downloadAttempted = true;
            
            try {
              const buffer = await response.buffer();
              // Generate timestamp-based filename to ensure unique files for each download  
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const filename = this.paperId ? `ssrn-${this.paperId}-${timestamp}.pdf` : `ssrn-unknown-${timestamp}.pdf`;
              const result = await this.savePDF(buffer, filename);
              
              if (result.success) {
                console.log("🎉 PDF DOWNLOADED SUCCESSFULLY VIA RESPONSE CAPTURE!");
                return result;
              }
            } catch (bufferError) {
              console.log(`⚠️ Buffer capture failed: ${bufferError.message}`);
              // Store URL for direct download attempt
              this.pdfUrls.push(url);
            }
          }
        }
        
        // Also check for redirects to PDF URLs
        if (status >= 300 && status < 400) {
          const location = response.headers()['location'];
          if (location && (location.includes('.pdf') || location.includes('download.ssrn.com'))) {
            console.log(`🔄 PDF REDIRECT: ${status} -> ${location}`);
            this.pdfUrls.push(location);
          }
        }
      });
      
      // Navigate to paper page with enhanced error handling
      console.log(`🌐 [Instance ${this.instanceId}] Loading paper page...`);
      
      try {
        await page.goto(paperUrl, { 
          waitUntil: "networkidle2",
          timeout: 45000 
        });
        
        const currentUrl = page.url();
        console.log(`📍 [Instance ${this.instanceId}] Current page URL: ${currentUrl}`);
        
        if (currentUrl === "about:blank") {
          throw new Error("Navigation failed, page is still about:blank");
        }
        
        const pageContent = await page.content();
        if (!pageContent || pageContent.includes("about:blank") || pageContent.length < 1000) {
          throw new Error("Navigation failed or proxy returned invalid content");
        }
        
        console.log(`✅ [Instance ${this.instanceId}] Successfully navigated to ${currentUrl}`);
        
        // IMPORTANT: Mark navigation success immediately for proxy affinity tracking
        // This allows the proxy to be used for alternative papers even if download fails later
        if (this.proxy && this.proxyManager && this.currentPaperId) {
          this.proxyManager.markProxyNavigationSuccessful(this.proxy, this.currentPaperId);
          console.log(`🌐 [Instance ${this.instanceId}] Marked navigation success - proxy can now be used for alternative papers`);
        }
        
      } catch (error) {
        console.log(`❌ [Instance ${this.instanceId}] Navigation failed: ${error.message}`);
        if (this.proxy) {
          throw new Error(`Proxy ${this.proxy} failed: ${error.message}`);
        }
        throw error;
      }
      
      // Wait for page to fully load
      console.log(`⏳ [Instance ${this.instanceId}] Waiting for page content to load...`);
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Handle cookies
      console.log(`🍪 [Instance ${this.instanceId}] Accepting cookies...`);
      const cookieResult = await page.evaluate(() => {
        const acceptBtn = document.querySelector('#onetrust-accept-btn-handler');
        if (acceptBtn && acceptBtn.offsetParent !== null) {
          acceptBtn.click();
          return true;
        }
        return false;
      });
      
      if (cookieResult) {
        console.log(`✅ [Instance ${this.instanceId}] Cookies accepted`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const cookies = await page.cookies();
        this.cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        console.log(`🍪 [Instance ${this.instanceId}] Captured ${cookies.length} cookies`);
      }
      
      // Start download process
      console.log(`🔍 [Instance ${this.instanceId}] Looking for download button...`);
      const downloadResult = await this.initiateDownload(page);
      
      if (downloadResult.found) {
        console.log(`✅ [Instance ${this.instanceId}] Download initiated: ${downloadResult.action}`);
        
        // Wait for download flow to complete
        console.log(`⏳ [Instance ${this.instanceId}] Monitoring network for PDF URLs...`);
        await new Promise(resolve => setTimeout(resolve, 25000));
        
        // Analyze all captured URLs
        console.log(`📊 [Instance ${this.instanceId}] Analysis of captured URLs:`);
        console.log(`💾 [Instance ${this.instanceId}] Total URLs captured: ${this.allUrls.length}`);
        console.log(`📄 [Instance ${this.instanceId}] Potential PDF URLs: ${this.pdfUrls.length}`);
        
        if (this.pdfUrls.length > 0) {
          console.log(`🎯 [Instance ${this.instanceId}] PDF URLs found:`);
          this.pdfUrls.forEach((url, index) => {
            console.log(`  ${index + 1}. ${url.substring(0, 100)}...`);
          });
          
          // Try downloading the most promising PDF URL
          const bestUrl = this.pdfUrls.find(url => 
            url.includes('download.ssrn.com') && url.includes('.pdf')
          ) || this.pdfUrls[this.pdfUrls.length - 1];
          
          if (bestUrl) {
            console.log(`📥 [Instance ${this.instanceId}] Attempting download of best URL...`);
            return await this.downloadDirectly(bestUrl);
          }
        } else {
          console.log(`⚠️ [Instance ${this.instanceId}] No PDF URLs captured in network traffic`);
          
          // Show last 10 URLs to debug
          console.log(`🔍 [Instance ${this.instanceId}] Last 10 URLs captured:`);
          this.allUrls.slice(-10).forEach((url, index) => {
            console.log(`  ${this.allUrls.length - 10 + index + 1}. ${url.substring(0, 120)}...`);
          });
        }
      }
      
      return { success: false, error: "Could not complete download flow" };
      
    } finally {
      try {
        await browser.close();
      } catch (closeError) {
        console.log(`⚠️  [Instance ${this.instanceId}] Error closing browser:`, closeError.message);
      } finally {
        activeBrowsers.delete(browser);
      }
    }
  }
  
  async initiateDownload(page) {
    // Look for download button - comprehensive search
    const result = await page.evaluate(() => {
      // Strategy 1: Look for direct download links
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        const text = link.textContent.toLowerCase().trim();
        const href = link.href || '';
        
        if ((text.includes('download') && text.includes('paper')) || 
            href.includes('Delivery.cfm')) {
          console.log('Found direct download:', text);
          link.click();
          return { found: true, action: 'Direct download clicked' };
        }
      }
      
      // Strategy 2: Look for "Download without registration"
      const buttons = Array.from(document.querySelectorAll('a, button'));
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase().trim();
        const className = btn.className || '';
        
        if (text.includes('download without registration') || 
            className.includes('show-download-module-btn')) {
          console.log('Found registration bypass:', text);
          btn.click();
          return { found: true, action: 'Registration bypass clicked' };
        }
      }
      
      // Strategy 3: Look for any download buttons
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase().trim();
        if (text.includes('download') && !text.includes('sign up')) {
          console.log('Found generic download:', text);
          btn.click();
          return { found: true, action: 'Generic download clicked' };
        }
      }
      
      return { found: false };
    });
    
    if (result.found) {
      // Wait for any modal or secondary button to appear
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Look for secondary download button
      const secondaryResult = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('a, button'));
        for (const btn of buttons) {
          const text = btn.textContent.toLowerCase().trim();
          const className = btn.className || '';
          
          if ((text === 'download' || text.includes('download')) && 
              className.includes('download-final-button')) {
            console.log('Found final download button:', text);
            btn.click();
            return { found: true, action: 'Final download button clicked' };
          }
        }
        return { found: false };
      });
      
      if (secondaryResult.found) {
        result.action += ' -> ' + secondaryResult.action;
      }
      
      // Wait for data integrity notice if it appears
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const currentUrl = await page.url();
      if (currentUrl.includes('Data_Integrity_Notice.cfm')) {
        console.log("📋 Handling data integrity notice...");
        
        const integrityResult = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
          for (const btn of buttons) {
            const text = btn.textContent?.toLowerCase().trim() || '';
            const value = btn.value?.toLowerCase().trim() || '';
            
            if (text.includes('accept') || text.includes('continue') || text.includes('download') ||
                value.includes('accept') || value.includes('continue') || value.includes('download')) {
              console.log('Found accept button:', text || value);
              btn.click();
              return { found: true, text: text || value };
            }
          }
          return { found: false };
        });
        
        if (integrityResult.found) {
          console.log(`✅ Clicked data integrity: ${integrityResult.text}`);
          result.action += ` -> Data integrity accepted (${integrityResult.text})`;
        }
      }
    }
    
    return result;
  }
  
  async downloadDirectly(url) {
    try {
      console.log(`📥 Direct download: ${url.substring(0, 100)}...`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/pdf,*/*',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'referer': 'https://papers.ssrn.com/',
          'cookie': this.cookies
        }
      });
      
      console.log(`📊 Response: ${response.status} ${response.headers.get('content-type')}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/pdf')) {
        console.log(`⚠️ Unexpected content type: ${contentType}`);
        // Try anyway - some servers don't set correct content-type
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Generate timestamp-based filename to ensure unique files for each download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = this.paperId ? `ssrn-${this.paperId}-${timestamp}.pdf` : `ssrn-unknown-${timestamp}.pdf`;
      return await this.savePDF(buffer, filename);
      
    } catch (error) {
      console.error("❌ Direct download failed:", error.message);
      return { success: false, error: error.message };
    }
  }
  
  async savePDF(buffer, filename) {
    try {
      if (buffer.length < 1024) {
        throw new Error(`File too small: ${buffer.length} bytes`);
      }
      
      const pdfHeader = buffer.toString('ascii', 0, 4);
      if (pdfHeader !== '%PDF') {
        console.log(`⚠️ Warning: Unusual file header: ${buffer.toString('ascii', 0, 20)}`);
        // Check if it's HTML error page
        if (buffer.toString('ascii', 0, 100).toLowerCase().includes('<html')) {
          throw new Error("Received HTML page instead of PDF");
        }
      } else {
        console.log("✅ Valid PDF header detected");
      }
      
      // Ensure downloads directory exists at the specified path
      const downloadsDir = '/Users/darshanbmehta/eb1/downloads';
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
        console.log(`✅ Created downloads directory: ${downloadsDir}`);
      }
      
      const filepath = path.join(downloadsDir, filename);
      fs.writeFileSync(filepath, buffer);
      
      const stats = fs.statSync(filepath);
      
      console.log(`✅ PDF saved successfully!`);
      console.log(`📁 Path: ${filepath}`);
      console.log(`📏 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      
      return {
        success: true,
        filepath: filepath,
        filename: filename,
        size: stats.size
      };
      
    } catch (error) {
      console.error("❌ Save error:", error.message);
      return { success: false, error: error.message };
    }
  }
}

// Enhanced Infinite Sequential Runner: For each proxy, try all paper IDs in sequence
async function runSequentialProxyRunner() {
  console.log("🚀 Starting Sequential SSRN Downloader: Each proxy will try all paper IDs in order");
  console.log("⏱️ Started at:", new Date().toLocaleTimeString());
  console.log("=" + "=".repeat(70));

  // Configuration
  const primaryPaperId = 5424002;
  // const alternativePaperIds = [5424004, 5356655, 5424035, 5356665, 5356661, 5356659, 5356657, 5295105];
  const alternativePaperIds = [5356655, 5356657];
  // const alternativePaperIds = [5424002]; 
  const allPaperIds = [primaryPaperId, ...alternativePaperIds];

  // Initialize proxy manager
  const proxyManager = new ProxyManager();
  const proxiesLoaded = await proxyManager.loadProxies();
  if (!proxiesLoaded) {
    console.error("❌ Failed to load proxies. Exiting...");
    return;
  }

  // Initialize success logger
  const successLogger = new SuccessLogger();
  successLogger.logSessionStart({ targetDownloads: 'sequential', batchSize: 1, concurrentInstances: 1 });

  let proxyIdx = 0;
  while (proxyIdx < proxyManager.proxies.length) {
    const proxy = proxyManager.proxies[proxyIdx];
    console.log(`\n🌐 Using proxy: ${proxy}`);
    // Try the first paper only
    const firstPaperId = allPaperIds[0];
    const firstPaperUrl = `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${firstPaperId}`;
    console.log(`\n🎯 Attempting FIRST Paper ID: ${firstPaperId} with Proxy: ${proxy}`);
    successLogger.logAttempt({ paperId: firstPaperId, proxy, instanceId: 1 });
    let firstResult;
    try {
      const downloader = new UltimateSSRNDownloader(proxy, 1);
      downloader.proxyManager = proxyManager;
      downloader.currentPaperId = firstPaperId;
      firstResult = await downloader.download(firstPaperUrl);
      if (firstResult && firstResult.success) {
        proxyManager.markProxySuccessful(proxy, firstPaperId);
        successLogger.logSuccess({
          ...firstResult,
          instanceId: 1,
          proxy,
          paperId: firstPaperId,
          duration: ((firstResult.size && firstResult.size > 0) ? (firstResult.size / 1024 / 1024).toFixed(2) : '0')
        });
      } else {
        if (firstResult && firstResult.error && (firstResult.error.includes('net::ERR_TUNNEL_CONNECTION_FAILED') || firstResult.error.includes('Navigation failed'))) {
          proxyManager.markProxyFailed(proxy);
        }
        proxyIdx++;
        continue; // Skip to next proxy
      }
    } catch (error) {
      console.log(`❌ Error for proxy ${proxy} on first paper ${firstPaperId}:`, error.message);
      proxyManager.markProxyFailed(proxy);
      proxyIdx++;
      continue;
    }
    // If first paper succeeded, try the rest
    for (let i = 1; i < allPaperIds.length; i++) {
      const paperId = allPaperIds[i];
      const paperUrl = `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${paperId}`;
      console.log(`\n🎯 Attempting Paper ID: ${paperId} with Proxy: ${proxy}`);
      successLogger.logAttempt({ paperId, proxy, instanceId: 1 });
      try {
        const downloader = new UltimateSSRNDownloader(proxy, 1);
        downloader.proxyManager = proxyManager;
        downloader.currentPaperId = paperId;
        const result = await downloader.download(paperUrl);
        if (result && result.success) {
          proxyManager.markProxySuccessful(proxy, paperId);
          successLogger.logSuccess({
            ...result,
            instanceId: 1,
            proxy,
            paperId,
            duration: ((result.size && result.size > 0) ? (result.size / 1024 / 1024).toFixed(2) : '0')
          });
        } else {
          if (result && result.error && (result.error.includes('net::ERR_TUNNEL_CONNECTION_FAILED') || result.error.includes('Navigation failed'))) {
            proxyManager.markProxyFailed(proxy);
            continue; // Mark as failed, but continue to try all papers
          }
        }
      } catch (error) {
        console.log(`❌ Error for proxy ${proxy} on paper ${paperId}:`, error.message);
        proxyManager.markProxyFailed(proxy);
        break;
      }
    }
    proxyIdx++;
  }

  // Log proxy-paper summary at the end of the session
  successLogger.logProxyPaperSummary();
}

// Run the new sequential runner
console.log("🚀 Initializing Ultimate SSRN Sequential Proxy Downloader...");
runSequentialProxyRunner().catch(error => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});  