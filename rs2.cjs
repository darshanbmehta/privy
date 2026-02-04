const { exec } = require("child_process");

const runCommand = () => {
  return new Promise((resolve, reject) => {
    exec("nid -p telecom-mas-agent -n 1000000 -m 30000 -t 1000000", { 
      timeout: 450000, // 7.5 minute process timeout
      maxBuffer: 1000 * 1024 * 1024, // 100MB buffer
      killSignal: 'SIGKILL'
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`Stderr: ${stderr}`);
      }
      console.log(`Output: ${stdout}`);
      resolve(stdout);
    });
  });
};

const runInIterations = async () => {
  const iter1 = 40;
  const iter = 10;
  
  try {
    for (let k = 0; k < iter1; k++) {
      console.log(`Starting batch ${k + 1}/${iter1}`);
      
      for (let i = 0; i < iter; i++) {
        console.log(`Batch ${k + 1}, Iteration ${i + 1}`);
        try {
          await runCommand(); // Wait for command to complete
          await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait for 1 minute
        } catch (error) {
          console.error(`Command failed in batch ${k + 1}, iteration ${i + 1}:`, error.message);
        }
      }
      
      if (k < iter1 - 1) { // Don't wait after the last batch
        console.log(`Batch ${k + 1} complete. Waiting 10 minutes before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 100000)); // Wait for 10 minutes
      }
    }
    console.log('All iterations completed successfully');
  } catch (error) {
    console.error('Fatal error in runInIterations:', error.message);
  }
};

runInIterations();