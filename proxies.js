import puppeteer from 'puppeteer';
import fetch from 'node-fetch';

// Enhanced function to scrape proxies from multiple sources
export const scrapeProxies = async () => {
  const allProxies = new Set(); // Use Set to avoid duplicates
  
  // Source 1: Scrape from free-proxy-list.net
  console.log('🔄 Scraping proxies from free-proxy-list.net...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('https://free-proxy-list.net/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const freeProxies = await page.evaluate(() => {
      const textarea = document.querySelector('textarea.form-control[readonly]');
      if (textarea) {
        return textarea.value
          .split('\n')
          .filter(line => line.match(/^\d+\.\d+\.\d+\.\d+:\d+$/));
      }
      return [];
    });
    
    freeProxies.forEach(proxy => allProxies.add(proxy));
    console.log(`✅ Scraped ${freeProxies.length} proxies from free-proxy-list.net`);
  } catch (error) {
    console.error('❌ Error scraping proxies from free-proxy-list.net:', error);
  } finally {
    await browser.close();
  }

  // Source 2: Fetch from AntoineVastel proxy bot IPs list
  console.log('🔄 Fetching proxies from AntoineVastel bot IPs list...');
  try {
    const resp = await fetch('https://raw.githubusercontent.com/antoinevastel/avastel-bot-ips-lists/refs/heads/master/avastel-proxy-bot-ips-1day.txt', {
      timeout: 30000
    });
    if (resp.ok) {
      const text = await resp.text();
      const vastelProxies = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
          // Skip comment lines starting with #
          if (line.startsWith('#')) return false;
          // Skip header line
          if (line.includes('ip_address;autonomous_system')) return false;
          // Skip empty lines
          if (!line) return false;
          // Check if line contains semicolon (IP;ISP format)
          return line.includes(';');
        })
        .map(line => {
          // Extract IP from "IP;ISP" format
          const ip = line.split(';')[0].trim();
          // Validate IP format
          return ip.match(/^\d+\.\d+\.\d+\.\d+$/) ? `${ip}:80` : null;
        })
        .filter(proxy => proxy !== null); // Remove invalid entries
      
      vastelProxies.forEach(proxy => allProxies.add(proxy));
      console.log(`✅ Fetched ${vastelProxies.length} proxies from AntoineVastel bot IPs list`);
    } else {
      console.warn('⚠️ Failed to fetch from AntoineVastel list');
    }
  } catch (error) {
    console.error('❌ Error fetching proxies from AntoineVastel list:', error);
  }

  // Source 3: Fetch from TheSpeedX/Proxy-List (GitHub raw)
  console.log('🔄 Fetching proxies from TheSpeedX/Proxy-List...');
  try {
    const resp = await fetch('https://raw.githubusercontent.com/TheSpeedX/Proxy-List/master/http.txt', {
      timeout: 30000
    });
    if (resp.ok) {
      const text = await resp.text();
      const speedxProxies = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.match(/^\d+\.\d+\.\d+\.\d+:\d+$/));
      
      speedxProxies.forEach(proxy => allProxies.add(proxy));
      console.log(`✅ Fetched ${speedxProxies.length} proxies from TheSpeedX/Proxy-List`);
    } else {
      console.warn('⚠️ Failed to fetch from TheSpeedX/Proxy-List');
    }
  } catch (error) {
    console.error('❌ Error fetching proxies from TheSpeedX/Proxy-List:', error);
  }

  const finalProxies = Array.from(allProxies);
  console.log(`🎯 Total unique proxies collected: ${finalProxies.length}`);
  
  if (finalProxies.length === 0) {
    console.error('❌ No proxies found from any source!');
    return [];
  }

  return finalProxies;

};

// Call scrapeProxies directly to show the output
(async () => {
  console.log('Starting proxy scraping...');
  const proxies = await scrapeProxies();
  console.log(`✅ Final proxy list ready: ${proxies.length} total proxies`);
  console.log('Sample proxies:', proxies.slice(0, 10));
})();