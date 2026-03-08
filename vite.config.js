import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        // a verificação estrita de hosts externos é desativada completamente
        allowedHosts: true
    }
});