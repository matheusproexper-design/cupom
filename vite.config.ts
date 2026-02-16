
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Define __dirname for ESM environments
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
    // Load env file from the current directory. 
    // On Vercel, this will also pick up system environment variables.
    const env = loadEnv(mode, process.cwd(), '');
    
    // Determine the API Key from available environment variables
    const apiKey = env.API_KEY || env.GEMINI_API_KEY || env.VITE_API_KEY || "";

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Use 'process.env.API_KEY' as the primary source as per coding guidelines
        'process.env.API_KEY': JSON.stringify(apiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(apiKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
