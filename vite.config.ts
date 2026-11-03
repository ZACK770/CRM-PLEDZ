import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: '/crm/', plugins: [react()], server: { proxy: { '/crm/api': 'http://127.0.0.1:8787' }, allowedHosts: true } });
