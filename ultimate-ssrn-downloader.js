// Ultimate SSRN Downloader - Captures ALL Download URLs
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

class UltimateSSRNDownloader {
  constructor() {
    this.allUrls = [];
    this.pdfUrls = [];
    this.cookies = "";
    this.downloadAttempted = false;
    this.paperId = null;
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

  async download(paperUrl) {
    // Reset state to ensure fresh URLs are fetched for this paper
    // CRITICAL: AWS signed URLs expire every 300 seconds (5 minutes)
    // Each download MUST get a fresh URL to avoid expiration errors
    this.resetState();
    
    // Extract paper ID for proper filename
    const extractedId = this.extractPaperId(paperUrl);
    if (extractedId) {
      this.paperId = extractedId;
      console.log(`📋 Paper ID: ${extractedId}`);
      console.log(`⏰ Fresh AWS URL fetch required - URLs expire every 300 seconds`);
    }
    
    console.log("🚀 Ultimate SSRN Downloader - Capturing ALL URLs");
    
    const browser = await puppeteer.launch({
      headless: false, // Run headless for batch processing speed
      args: [
        // "--incognito",
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--disable-blink-features=AutomationControlled"
      ]
    });
    
    try {
      const page = await browser.newPage();
      
      // Set realistic user agent and viewport
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Enhanced stealth mode
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
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
      
      // Navigate to paper page
      console.log("🌐 Loading paper page...");
      await page.goto(paperUrl, { 
        waitUntil: "networkidle2",
        timeout: 60000 
      });
      
      // Wait for page to fully load
      console.log("⏳ Waiting for page content to load...");
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Handle cookies
      console.log("🍪 Accepting cookies...");
      const cookieResult = await page.evaluate(() => {
        const acceptBtn = document.querySelector('#onetrust-accept-btn-handler');
        if (acceptBtn && acceptBtn.offsetParent !== null) {
          acceptBtn.click();
          return true;
        }
        return false;
      });
      
      if (cookieResult) {
        console.log("✅ Cookies accepted");
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const cookies = await page.cookies();
        this.cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        console.log(`🍪 Captured ${cookies.length} cookies`);
      }
      
      // Start download process
      console.log("🔍 Looking for download button...");
      const downloadResult = await this.initiateDownload(page);
      
      if (downloadResult.found) {
        console.log(`✅ Download initiated: ${downloadResult.action}`);
        
        // Wait for download flow to complete
        console.log("⏳ Monitoring network for PDF URLs...");
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Analyze all captured URLs
        console.log("📊 Analysis of captured URLs:");
        console.log(`💾 Total URLs captured: ${this.allUrls.length}`);
        console.log(`📄 Potential PDF URLs: ${this.pdfUrls.length}`);
        
        if (this.pdfUrls.length > 0) {
          console.log("🎯 PDF URLs found:");
          this.pdfUrls.forEach((url, index) => {
            console.log(`  ${index + 1}. ${url.substring(0, 100)}...`);
          });
          
          // Try downloading the most promising PDF URL
          const bestUrl = this.pdfUrls.find(url => 
            url.includes('download.ssrn.com') && url.includes('.pdf')
          ) || this.pdfUrls[this.pdfUrls.length - 1];
          
          if (bestUrl) {
            console.log("📥 Attempting download of best URL...");
            return await this.downloadDirectly(bestUrl);
          }
        } else {
          console.log("⚠️ No PDF URLs captured in network traffic");
          
          // Show last 10 URLs to debug
          console.log("🔍 Last 10 URLs captured:");
          this.allUrls.slice(-10).forEach((url, index) => {
            console.log(`  ${this.allUrls.length - 10 + index + 1}. ${url.substring(0, 120)}...`);
          });
        }
      }
      
      return { success: false, error: "Could not complete download flow" };
      
    } finally {
      await browser.close();
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

// Batch Loop Runner - 100 Downloads
async function runBatchLoop() {
  console.log("🚀 Starting 100 SSRN Downloads with Ultimate Downloader");
  console.log("📋 Using proven working solution in loop mode");
  console.log("⏱️ Started at:", new Date().toLocaleTimeString());
  console.log("=" + "=".repeat(60));
  
  const baseId = 5424002;
  const results = [];
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < 100; i++) {
    // Use the fixed paper ID 5424002 for all downloads
    // const paperId = 5424002; 
    const paperId = 5356661;
    const paperUrl = `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${paperId}`;
    
    console.log(`\n📋 Download ${i + 1}/100: Paper ID ${paperId}`);
    console.log(`⏱️ Time: ${new Date().toLocaleTimeString()}`);
    
    const downloadStartTime = Date.now();
    
    try {
      const downloader = new UltimateSSRNDownloader();
      
      // Override savePDF to use correct filename for each paper
      const originalSavePDF = downloader.savePDF.bind(downloader);
      downloader.savePDF = function(buffer, _) {
        return originalSavePDF(buffer, `ssrn-${paperId}.pdf`);
      };
      
      const result = await downloader.download(paperUrl);
      const duration = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
      
      if (result && result.success) {
        successCount++;
        console.log(`✅ Success ${successCount}/100 (${duration}s): ${result.filename} (${(result.size/1024/1024).toFixed(2)} MB)`);
        
        // Track successful download
        results.push({ success: true, filename: result.filename, size: result.size });
      } else {
        failCount++;
        const error = result ? result.error : "Unknown error";
        console.log(`❌ Failed ${failCount}/100 (${duration}s): ${error}`);
        
        // Track failed download
        results.push({ success: false, error: error });
      }
      
      // Progress report every 10 downloads
      if ((i + 1) % 10 === 0) {
        const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        const successRate = ((successCount / (i + 1)) * 100).toFixed(1);
        const avgTime = ((Date.now() - startTime) / (i + 1) / 1000).toFixed(1);
        
        console.log(`\n📊 Progress Report: ${i + 1}/100 completed`);
        console.log(`✅ Successful: ${successCount} (${successRate}%)`);
        console.log(`❌ Failed: ${failCount}`);
        console.log(`⏱️ Total time: ${totalTime} minutes`);
        console.log(`📈 Average per paper: ${avgTime}s`);
        console.log("=" + "=".repeat(50));
      }
      
    } catch (error) {
      const duration = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
      failCount++;
      console.error(`💥 Fatal error on paper ${paperId} (${duration}s):`, error.message);
      
      results.push({
        success: false,
        error: error.message
      });
    }
    
    // Delay between downloads to avoid rate limiting
    if (i < 99) {
      const delay = 8000 + Math.random() * 4000; // 8-12 seconds
      console.log(`⏳ Waiting ${(delay/1000).toFixed(1)}s before next download...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Generate final report
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const successRate = ((successCount / 100) * 100).toFixed(1);
  const successfulDownloads = results.filter(r => r.success);
  const totalSize = successfulDownloads.reduce((sum, r) => sum + (r.size || 0), 0);
  
  console.log("\n" + "=".repeat(70));
  console.log("🎉 BATCH DOWNLOAD COMPLETE!");
  console.log("=".repeat(70));
  console.log(`📊 Total Attempts: 100`);
  console.log(`✅ Successful Downloads: ${successCount} (${successRate}%)`);
  console.log(`❌ Failed Downloads: ${failCount}`);
  console.log(`⏱️ Total Runtime: ${totalTime} minutes`);
  console.log(`📁 Total Data Downloaded: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📈 Average Time: ${(parseFloat(totalTime) * 60 / 100).toFixed(1)}s per paper`);
  
  // No CSV report needed - just show summary
  
  // List successful downloads
  if (successCount > 0) {
    console.log(`\n📁 Successfully Downloaded Files (${successCount}):`);
    successfulDownloads.slice(0, 5).forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.filename} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    });
    if (successCount > 5) {
      console.log(`  ... and ${successCount - 5} more files in ./downloads/`);
    }
  }
  
  console.log("=".repeat(70));
  
  return results;
}

// Run the batch loop
console.log("🚀 Initializing Ultimate SSRN Batch Downloader...");
runBatchLoop().catch(error => {
  console.error("💥 Fatal batch error:", error);
  process.exit(1);
});
