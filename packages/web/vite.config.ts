import { defineConfig } from 'vite';

// base './' keeps the build relocatable: served by the OPC server at '/', or from any static host.
export default defineConfig({ base: './', build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' } });
